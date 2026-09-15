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


def print_rows(title, rows, columns, limit):
    print(f"\n{title}: {len(rows):,} candidate group(s)")
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

    product_candidates = db.execute("""
      SELECT
        LOWER(TRIM(COALESCE(brand_name,''))) brand,
        LOWER(TRIM(COALESCE(product_name,''))) product_name,
        LOWER(TRIM(COALESCE(product_type,''))) product_type,
        COUNT(*) copies,
        GROUP_CONCAT(id) product_ids
      FROM cannabis_products
      WHERE id IN (SELECT DISTINCT product_id FROM cannabis_batches WHERE source_name='Cannlytics')
      GROUP BY brand,product_name,product_type
      HAVING COUNT(*) > 1
      ORDER BY copies DESC,product_name
    """).fetchall()
    print_rows("Canonical-looking Cannlytics product duplicates", product_candidates,
               ["brand", "product_name", "product_type", "copies", "product_ids"], args.limit)

    multi_source_to_batch = db.execute("""
      SELECT batch_id,COUNT(*) source_records,COUNT(DISTINCT state_code) states
      FROM cannlytics_source_records
      WHERE batch_id IS NOT NULL
      GROUP BY batch_id
      HAVING COUNT(*) > 1
      ORDER BY source_records DESC,batch_id
    """).fetchall()
    print_rows("Multiple Cannlytics source records linked to one batch", multi_source_to_batch,
               ["batch_id", "source_records", "states"], args.limit)

    print("\nInterpretation")
    print("  Exact source-key duplicates should be impossible because external_key is the primary key.")
    print("  Batch/product candidate groups are not automatically safe to delete: separate labs or source IDs can legitimately describe the same-looking batch.")
    print("  Review candidates before any merge/removal, and preserve stronger direct-lab evidence when consolidating.")
    db.close()


if __name__ == "__main__":
    main()
