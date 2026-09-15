#!/usr/bin/env python3
"""Read-only Cannlytics duplicate audit for the GeoWeedo runtime database.

This script never mutates data. It distinguishes schema-level duplicates that
should be impossible under the current importer from semantic duplicate
candidates that require review before any merge/removal.
"""
import argparse
import sqlite3
from pathlib import Path

ROOT = Path.cwd()
DEFAULT_DB = ROOT / "data" / "runtime" / "geoweedo.sqlite"


def scalar(db, sql, params=()):
    return int(db.execute(sql, params).fetchone()[0] or 0)


def print_rows(title, rows, columns, limit, note=None):
    print(f"\n{title}: {len(rows):,} candidate group(s)")
    if note:
        print(f"  {note}")
    for row in rows[:limit]:
        print("  - " + " | ".join(f"{name}={row[name]!s}" for name in columns))
    if len(rows) > limit:
        print(f"  ... {len(rows) - limit:,} more group(s) not shown")


def main():
    parser = argparse.ArgumentParser(description="Audit Cannlytics data for duplicate candidates without changing the database.")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--limit", type=int, default=30, help="Maximum candidate groups to print per section.")
    args = parser.parse_args()
    db_path = Path(args.db)
    if not db_path.exists():
        raise SystemExit(f"GeoWeedo database not found: {db_path}")

    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=60)
    db.row_factory = sqlite3.Row

    source_rows = scalar(db, "SELECT COUNT(*) FROM cannlytics_source_records")
    source_keys = scalar(db, "SELECT COUNT(DISTINCT external_key) FROM cannlytics_source_records")
    source_ids = scalar(db, "SELECT COUNT(DISTINCT state_code || ':' || source_record_id) FROM cannlytics_source_records")
    cann_batches = scalar(db, "SELECT COUNT(*) FROM cannabis_batches WHERE source_name='Cannlytics'")
    cann_products = scalar(db, "SELECT COUNT(DISTINCT product_id) FROM cannabis_batches WHERE source_name='Cannlytics'")
    cann_coa = scalar(db, "SELECT COUNT(*) FROM cannabis_coa_sources WHERE source_name='Cannlytics'")

    print("Cannlytics duplicate audit (READ ONLY)")
    print(f"Database: {db_path}")
    print(f"Source records: {source_rows:,}")
    print(f"Distinct external keys: {source_keys:,}")
    print(f"Distinct state/source IDs: {source_ids:,}")
    print(f"Cannlytics batches: {cann_batches:,}")
    print(f"Products referenced by Cannlytics batches: {cann_products:,}")
    print(f"Cannlytics COA-source rows: {cann_coa:,}")

    exact_problem = source_rows != source_keys or source_rows != source_ids
    print(f"\nExact source-key duplicate problem: {'YES' if exact_problem else 'no'}")

    duplicate_coa = db.execute("""
      SELECT external_id,COUNT(*) copies,COUNT(DISTINCT COALESCE(batch_id,'')) batches
      FROM cannabis_coa_sources
      WHERE source_name='Cannlytics' AND external_id IS NOT NULL
      GROUP BY external_id
      HAVING COUNT(*) > 1
      ORDER BY copies DESC,external_id
    """).fetchall()
    print_rows("Duplicate Cannlytics COA mappings", duplicate_coa, ["external_id", "copies", "batches"], args.limit)

    analyte_dupes = db.execute("""
      SELECT a.batch_id,a.group_name,a.analyte_name,COUNT(*) copies
      FROM cannabis_analytes a
      JOIN cannabis_batches b ON b.id=a.batch_id
      WHERE b.source_name='Cannlytics'
      GROUP BY a.batch_id,LOWER(TRIM(a.group_name)),LOWER(TRIM(a.analyte_name))
      HAVING COUNT(*) > 1
      ORDER BY copies DESC,a.batch_id
    """).fetchall()
    print_rows("Duplicate analytes inside one Cannlytics batch", analyte_dupes, ["batch_id", "group_name", "analyte_name", "copies"], args.limit)

    batch_candidates = db.execute("""
      SELECT
        LOWER(TRIM(COALESCE(p.product_name,''))) product_name,
        LOWER(TRIM(COALESCE(b.producer_name,''))) producer,
        LOWER(TRIM(COALESCE(b.batch_number,''))) batch_number,
        LOWER(TRIM(COALESCE(b.coa_number,''))) coa_number,
        COALESCE(SUBSTR(b.tested_at,1,10),'') tested_day,
        COUNT(*) copies,
        GROUP_CONCAT(b.id) batch_ids
      FROM cannabis_batches b
      JOIN cannabis_products p ON p.id=b.product_id
      WHERE b.source_name='Cannlytics'
        AND (COALESCE(TRIM(b.batch_number),'')<>'' OR COALESCE(TRIM(b.coa_number),'')<>'')
      GROUP BY product_name,producer,batch_number,coa_number,tested_day
      HAVING COUNT(*) > 1
      ORDER BY copies DESC,product_name
    """).fetchall()
    print_rows("Likely duplicate real-world Cannlytics batches", batch_candidates,
               ["product_name", "producer", "batch_number", "coa_number", "tested_day", "copies", "batch_ids"], args.limit)

    # The importer hashes product identity from (brand OR producer) + product name
    # + product type. The old audit grouped only on brand/name/type, which made
    # unbranded products from different producers look like duplicates.
    product_context_sql = """
      WITH product_context AS (
        SELECT
          p.id product_id,
          LOWER(TRIM(COALESCE(p.brand_name,''))) brand,
          LOWER(TRIM(COALESCE(p.product_name,''))) product_name,
          LOWER(TRIM(COALESCE(p.product_type,''))) product_type,
          COUNT(DISTINCT NULLIF(LOWER(TRIM(COALESCE(b.producer_name,''))),'')) producer_count,
          MIN(NULLIF(LOWER(TRIM(COALESCE(b.producer_name,''))),'')) producer,
          COUNT(*) batch_count
        FROM cannabis_products p
        JOIN cannabis_batches b ON b.product_id=p.id AND b.source_name='Cannlytics'
        GROUP BY p.id
      ), identities AS (
        SELECT
          *,
          CASE
            WHEN brand<>'' THEN 'brand:' || brand
            WHEN producer_count=1 THEN 'producer:' || producer
            WHEN producer_count=0 THEN 'unknown:'
            ELSE 'ambiguous:'
          END effective_owner
        FROM product_context
      )
    """

    identity_collisions = db.execute(product_context_sql + """
      SELECT
        effective_owner,
        product_name,
        product_type,
        COUNT(*) copies,
        SUM(batch_count) batches,
        GROUP_CONCAT(product_id) product_ids
      FROM identities
      WHERE effective_owner NOT IN ('unknown:','ambiguous:')
      GROUP BY effective_owner,product_name,product_type
      HAVING COUNT(*) > 1
      ORDER BY copies DESC,product_name
    """).fetchall()
    print_rows(
        "True Cannlytics product identity collisions",
        identity_collisions,
        ["effective_owner", "product_name", "product_type", "copies", "batches", "product_ids"],
        args.limit,
        "These use the same brand-or-producer identity rule as the importer and are the product groups most worth reviewing for merge.",
    )

    appearance_only = db.execute(product_context_sql + """
      SELECT
        product_name,
        product_type,
        COUNT(*) products,
        COUNT(DISTINCT effective_owner) owners,
        GROUP_CONCAT(product_id) product_ids
      FROM identities
      GROUP BY product_name,product_type
      HAVING COUNT(*) > 1 AND COUNT(DISTINCT effective_owner) > 1
      ORDER BY products DESC,product_name
    """).fetchall()
    print_rows(
        "Same-looking products across different owners (informational)",
        appearance_only,
        ["product_name", "product_type", "products", "owners", "product_ids"],
        args.limit,
        "These are not duplicates merely because the display name matches; different brands/producers intentionally remain separate identities.",
    )

    ambiguous_owner = db.execute(product_context_sql + """
      SELECT
        product_id,
        product_name,
        product_type,
        producer_count,
        batch_count
      FROM identities
      WHERE brand='' AND producer_count>1
      ORDER BY producer_count DESC,batch_count DESC,product_name
    """).fetchall()
    print_rows(
        "Unbranded Cannlytics products spanning multiple producers",
        ambiguous_owner,
        ["product_id", "product_name", "product_type", "producer_count", "batch_count"],
        args.limit,
        "These are ambiguous historical identities and should be reviewed before any split or merge.",
    )

    multi_source_to_batch = db.execute("""
      SELECT batch_id,COUNT(*) source_records,COUNT(DISTINCT state_code) states
      FROM cannlytics_source_records
      WHERE batch_id IS NOT NULL
      GROUP BY batch_id
      HAVING COUNT(*) > 1
      ORDER BY source_records DESC,batch_id
    """).fetchall()
    print_rows(
        "Cannlytics source consolidation onto one batch (informational)",
        multi_source_to_batch,
        ["batch_id", "source_records", "states"],
        args.limit,
        "Multiple source observations pointing at one batch are usually successful consolidation, not duplicate rows to delete.",
    )

    orphan_products = db.execute("""
      SELECT p.id product_id,p.brand_name,p.product_name,p.product_type
      FROM cannabis_products p
      WHERE p.id LIKE 'cp-cann-%'
        AND NOT EXISTS (SELECT 1 FROM cannabis_batches b WHERE b.product_id=p.id)
      ORDER BY p.product_name COLLATE NOCASE,p.id
    """).fetchall()
    print_rows(
        "Orphaned Cannlytics-created products",
        orphan_products,
        ["product_id", "brand_name", "product_name", "product_type"],
        args.limit,
        "These have no remaining batch references. If any exist, they are candidates for a separate cleanup after review.",
    )

    print("\nInterpretation")
    print("  Exact source-key duplicates should be impossible because external_key is the primary key.")
    print("  Do not delete same-looking products across different owners; producer/brand is part of Cannlytics product identity.")
    print("  Multiple source records mapped to one batch are generally expected consolidation, not duplication.")
    print("  Review true identity collisions and ambiguous-owner products before any merge/removal.")
    print("  This audit never changes the database.")
    db.close()


if __name__ == "__main__":
    main()
