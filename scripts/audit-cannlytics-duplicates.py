#!/usr/bin/env python3
"""Read-only Cannlytics duplicate audit for the GeoWeedo runtime database.

This script never mutates data. It distinguishes schema-level duplicates that
should be impossible under the current importer from semantic duplicate
candidates that require review before any merge/removal.
"""
import argparse
import hashlib
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

ROOT = Path.cwd()
DEFAULT_DB = ROOT / "data" / "runtime" / "geoweedo.sqlite"


def scalar(db, sql, params=()):
    return int(db.execute(sql, params).fetchone()[0] or 0)


def norm(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def stable_hash(prefix, value, length=24):
    return prefix + hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def print_rows(title, rows, columns, limit, note=None):
    print(f"\n{title}: {len(rows):,} candidate group(s)")
    if note:
        print(f"  {note}")
    for row in rows[:limit]:
        print("  - " + " | ".join(f"{name}={row[name]!s}" for name in columns))
    if len(rows) > limit:
        print(f"  ... {len(rows) - limit:,} more group(s) not shown")


def build_product_identity_audit(db):
    """Mirror the importer's exact product identity normalization and hashing."""
    products = {}
    rows = db.execute("""
      SELECT p.id product_id,p.brand_name,p.product_name,p.product_type,b.producer_name
      FROM cannabis_products p
      JOIN cannabis_batches b ON b.product_id=p.id
      WHERE b.source_name='Cannlytics'
    """).fetchall()

    for row in rows:
        product_id = str(row["product_id"])
        context = products.setdefault(product_id, {
            "product_id": product_id,
            "brand": norm(row["brand_name"]),
            "product_name": norm(row["product_name"]),
            "product_type": norm(row["product_type"]),
            "producers": set(),
            "batch_count": 0,
        })
        producer = norm(row["producer_name"])
        if producer:
            context["producers"].add(producer)
        context["batch_count"] += 1

    identity_groups = defaultdict(list)
    appearance_groups = defaultdict(list)
    ambiguous = []
    deterministic_mismatches = []

    for context in products.values():
        brand = context["brand"]
        producers = context["producers"]
        if brand:
            owner_kind = "brand"
            owner = brand
        elif len(producers) == 1:
            owner_kind = "producer"
            owner = next(iter(producers))
        elif len(producers) == 0:
            owner_kind = "unknown"
            owner = ""
        else:
            owner_kind = "ambiguous"
            owner = ""

        context["owner_kind"] = owner_kind
        context["owner"] = owner
        context["effective_owner"] = f"{owner_kind}:{owner}"
        context["producer_count"] = len(producers)

        if owner_kind == "ambiguous":
            ambiguous.append({
                "product_id": context["product_id"],
                "product_name": context["product_name"],
                "product_type": context["product_type"],
                "producer_count": len(producers),
                "batch_count": context["batch_count"],
            })
            continue

        identity_key = (context["effective_owner"], context["product_name"], context["product_type"])
        identity_groups[identity_key].append(context)
        appearance_groups[(context["product_name"], context["product_type"])].append(context)

        expected_id = stable_hash(
            "cp-cann-",
            "|".join([owner, context["product_name"], context["product_type"]]),
        )
        if context["product_id"].startswith("cp-cann-") and context["product_id"] != expected_id:
            deterministic_mismatches.append({
                "product_id": context["product_id"],
                "expected_id": expected_id,
                "effective_owner": context["effective_owner"],
                "product_name": context["product_name"],
                "product_type": context["product_type"],
                "batch_count": context["batch_count"],
            })

    collisions = []
    for (effective_owner, product_name, product_type), group in identity_groups.items():
        if len(group) <= 1:
            continue
        collisions.append({
            "effective_owner": effective_owner,
            "product_name": product_name,
            "product_type": product_type,
            "copies": len(group),
            "batches": sum(item["batch_count"] for item in group),
            "product_ids": ",".join(sorted(item["product_id"] for item in group)),
        })
    collisions.sort(key=lambda row: (-row["copies"], row["product_name"], row["effective_owner"]))

    appearance_only = []
    for (product_name, product_type), group in appearance_groups.items():
        owners = {item["effective_owner"] for item in group}
        if len(group) <= 1 or len(owners) <= 1:
            continue
        appearance_only.append({
            "product_name": product_name,
            "product_type": product_type,
            "products": len(group),
            "owners": len(owners),
            "product_ids": ",".join(sorted(item["product_id"] for item in group)),
        })
    appearance_only.sort(key=lambda row: (-row["products"], row["product_name"]))

    ambiguous.sort(key=lambda row: (-row["producer_count"], -row["batch_count"], row["product_name"]))
    deterministic_mismatches.sort(key=lambda row: (-row["batch_count"], row["product_name"], row["product_id"]))
    return collisions, appearance_only, ambiguous, deterministic_mismatches


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

    identity_collisions, appearance_only, ambiguous_owner, deterministic_mismatches = build_product_identity_audit(db)

    print_rows(
        "True Cannlytics product identity collisions",
        identity_collisions,
        ["effective_owner", "product_name", "product_type", "copies", "batches", "product_ids"],
        args.limit,
        "These use the exact normalization and brand-or-producer identity rule used by the importer; these are the strongest product merge candidates.",
    )

    print_rows(
        "Cannlytics products not matching the current deterministic ID",
        deterministic_mismatches,
        ["product_id", "expected_id", "effective_owner", "product_name", "product_type", "batch_count"],
        args.limit,
        "These may be legacy identity rows. A mismatch alone is not permission to delete; it is a strong signal for targeted reconciliation.",
    )

    print_rows(
        "Same-looking products across different owners (informational)",
        appearance_only,
        ["product_name", "product_type", "products", "owners", "product_ids"],
        args.limit,
        "These are not duplicates merely because the display name matches; different brands/producers intentionally remain separate identities.",
    )

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
    print("  Review true identity collisions, deterministic-ID mismatches, and ambiguous-owner products before any merge/removal.")
    print("  This audit never changes the database.")
    db.close()


if __name__ == "__main__":
    main()
