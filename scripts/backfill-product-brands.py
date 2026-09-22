#!/usr/bin/env python3
"""Fast, safe backfill of missing GeoWeedo cannabis product brands.

This version is designed for the full public catalog (tens of thousands of
products). It avoids per-product SQL queries and instead loads each evidence
source in one pass.

Evidence priority:
1. Brand already captured with a QR scan.
2. Explicit brand-like fields preserved in Cannlytics raw provenance.
3. Conservative brand patterns embedded in the product title.

Dry-run by default. Pass --apply to persist changes. Apply mode creates a
consistent SQLite backup first unless --no-backup is supplied.
"""

import argparse
import json
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd()
DB_PATH = ROOT / "data" / "runtime" / "geoweedo.sqlite"
BACKUP_DIR = ROOT / "data" / "backups"

BRAND_KEYS = (
    "brand_name", "brand", "product_brand", "product_brand_name", "brand_owner",
    "brand_label", "brandname", "trade_name", "trade_brand", "dba_brand",
)


def clean(value):
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    if not text or text.lower() in {"nan", "none", "null", "n/a", "na"}:
        return None
    return text


def key_name(value):
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower())).strip("_")


def infer_brand_from_product_name(product_name):
    """Conservative fallback for source rows that embed a brand in the title."""
    text = clean(product_name)
    if not text:
        return None

    # [Turn Down] - BB turnONE - ...
    bracket = re.match(r"^\[([^\]]{2,60})\]\s*(?:[-|:])", text)
    if bracket:
        return clean(bracket.group(1))

    # TCO | minis | Spray Paint | ...
    if " | " in text:
        prefix = clean(text.split(" | ", 1)[0])
        if prefix and len(prefix) <= 60:
            return prefix

    # Shaman Cured Resin Vape - ...
    # Keep intentionally strict: only one-word prefixes before known forms.
    lowered = text.lower()
    forms = (
        "cured resin vape", "live resin vape", "resin vape", "rosin vape",
        "vape cartridge", "vape cart", "disposable vape",
    )
    for form in forms:
        marker = f" {form}"
        pos = lowered.find(marker)
        if 1 < pos <= 32:
            prefix = clean(text[:pos])
            if prefix and " " not in prefix and re.fullmatch(r"[A-Za-z0-9&.'-]{2,32}", prefix):
                return prefix
    return None


def has_table(db, name):
    return bool(db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", (name,)
    ).fetchone())


def table_columns(db, table):
    if not has_table(db, table):
        return set()
    return {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def parse_cannlytics_brand(raw_payload):
    try:
        payload = json.loads(raw_payload)
    except Exception:
        return None
    source = payload.get("row") if isinstance(payload, dict) and isinstance(payload.get("row"), dict) else payload
    if not isinstance(source, dict):
        return None
    normalized = {key_name(k): v for k, v in source.items()}
    for key in BRAND_KEYS:
        value = clean(normalized.get(key_name(key)))
        if value:
            return value
    return None


def elapsed(start):
    return f"{time.monotonic() - start:.1f}s"


def create_target_table(db, limit):
    db.execute("DROP TABLE IF EXISTS temp.brand_backfill_targets")
    db.execute("""
      CREATE TEMP TABLE brand_backfill_targets(
        id TEXT PRIMARY KEY,
        product_name TEXT NOT NULL
      ) WITHOUT ROWID
    """)
    sql = """
      INSERT INTO brand_backfill_targets(id,product_name)
      SELECT id,product_name
      FROM cannabis_products
      WHERE brand_name IS NULL OR TRIM(brand_name)=''
      ORDER BY updated_at DESC, product_name COLLATE NOCASE
    """
    params = ()
    if limit > 0:
        sql += " LIMIT ?"
        params = (limit,)
    db.execute(sql, params)
    return int(db.execute("SELECT COUNT(*) FROM brand_backfill_targets").fetchone()[0])


def load_qr_brands(db, found, sources):
    cols = table_columns(db, "cannabis_qr_scans")
    if not {"product_id", "brand_name", "last_seen_at"} <= cols:
        return 0

    added = 0
    current_id = None
    for row in db.execute("""
      SELECT q.product_id,q.brand_name
      FROM cannabis_qr_scans q
      JOIN brand_backfill_targets t ON t.id=q.product_id
      WHERE q.brand_name IS NOT NULL AND TRIM(q.brand_name)<>''
      ORDER BY q.product_id, q.last_seen_at DESC
    """):
        product_id = str(row[0])
        if product_id == current_id:
            continue
        current_id = product_id
        brand = clean(row[1])
        if brand and product_id not in found:
            found[product_id] = brand
            sources[product_id] = "qr_scan"
            added += 1
    return added


def load_cannlytics_brands(db, found, sources):
    if not has_table(db, "cannabis_batches") or not has_table(db, "cannabis_coa_sources"):
        return 0

    added = 0
    resolved_products = set(found)
    cursor = db.execute("""
      SELECT b.product_id,s.raw_payload_json
      FROM cannabis_coa_sources s
      JOIN cannabis_batches b ON b.id=s.batch_id
      JOIN brand_backfill_targets t ON t.id=b.product_id
      WHERE s.source_name='Cannlytics'
        AND s.raw_payload_json IS NOT NULL
        AND TRIM(s.raw_payload_json)<>''
      ORDER BY b.product_id, COALESCE(s.fetched_at,s.created_at) DESC
    """)
    for product_id, raw_payload in cursor:
        product_id = str(product_id)
        if product_id in resolved_products:
            continue
        brand = parse_cannlytics_brand(raw_payload)
        if not brand:
            continue
        found[product_id] = brand
        sources[product_id] = "cannlytics"
        resolved_products.add(product_id)
        added += 1
    return added


def load_title_brands(db, found, sources):
    added = 0
    for product_id, product_name in db.execute(
        "SELECT id,product_name FROM brand_backfill_targets ORDER BY product_name COLLATE NOCASE"
    ):
        product_id = str(product_id)
        if product_id in found:
            continue
        brand = infer_brand_from_product_name(product_name)
        if not brand:
            continue
        found[product_id] = brand
        sources[product_id] = "product_title"
        added += 1
    return added


def consistent_backup(db):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = BACKUP_DIR / f"geoweedo-before-brand-backfill-{stamp}.sqlite"
    target = sqlite3.connect(path)
    try:
        db.backup(target)
    finally:
        target.close()
    return path


def main():
    parser = argparse.ArgumentParser(description="Fast backfill of missing GeoWeedo product brands.")
    parser.add_argument("--apply", action="store_true", help="Persist recovered brands.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum missing-brand products to inspect.")
    parser.add_argument("--no-backup", action="store_true", help="Skip the automatic SQLite backup in --apply mode.")
    parser.add_argument("--show", type=int, default=50, help="Number of recovered rows to preview.")
    args = parser.parse_args()

    if not DB_PATH.exists():
        raise SystemExit(f"GeoWeedo database not found: {DB_PATH}")

    started = time.monotonic()
    db = sqlite3.connect(DB_PATH, timeout=120)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=120000")
    db.execute("PRAGMA temp_store=MEMORY")
    db.execute("PRAGMA cache_size=-64000")

    try:
        print("Preparing missing-brand product set...", flush=True)
        target_count = create_target_table(db, max(0, int(args.limit or 0)))
        print(f"  {target_count:,} missing-brand products selected ({elapsed(started)})", flush=True)

        found = {}
        sources = {}

        phase = time.monotonic()
        qr_count = load_qr_brands(db, found, sources)
        print(f"QR scan evidence: {qr_count:,} recovered ({time.monotonic()-phase:.1f}s)", flush=True)

        phase = time.monotonic()
        cannlytics_count = load_cannlytics_brands(db, found, sources)
        print(f"Cannlytics provenance: {cannlytics_count:,} recovered ({time.monotonic()-phase:.1f}s)", flush=True)

        phase = time.monotonic()
        title_count = load_title_brands(db, found, sources)
        print(f"Product-title inference: {title_count:,} recovered ({time.monotonic()-phase:.1f}s)", flush=True)

        print(f"\nRecoverable brands: {len(found):,} / {target_count:,}")
        print(
            "Sources: "
            f"QR scan={qr_count:,}, "
            f"Cannlytics provenance={cannlytics_count:,}, "
            f"title inference={title_count:,}"
        )

        preview_rows = db.execute("""
          SELECT t.id,t.product_name
          FROM brand_backfill_targets t
          ORDER BY t.product_name COLLATE NOCASE
        """).fetchall()
        shown = 0
        for row in preview_rows:
            product_id = str(row["id"])
            brand = found.get(product_id)
            if not brand:
                continue
            print(f"  {brand} | {row['product_name']} | {product_id} | {sources[product_id]}")
            shown += 1
            if shown >= max(0, int(args.show)):
                break
        if len(found) > shown:
            print(f"  ... {len(found)-shown:,} more")

        if not args.apply:
            print(f"\nDRY RUN COMPLETE in {elapsed(started)} — no database changes were made.")
            print("If the recovered brands look correct, rerun with --apply.")
            return 0

        if not found:
            print(f"\nNothing to apply. Finished in {elapsed(started)}.")
            return 0

        if not args.no_backup:
            phase = time.monotonic()
            print("\nCreating consistent SQLite backup before changes...", flush=True)
            backup = consistent_backup(db)
            print(f"  Backup: {backup} ({time.monotonic()-phase:.1f}s)", flush=True)

        now = datetime.now(timezone.utc).isoformat()
        name_by_id = {
            str(row["id"]): str(row["product_name"])
            for row in db.execute("SELECT id,product_name FROM brand_backfill_targets")
        }
        updates = [
            (
                brand,
                f"{brand} {name_by_id[product_id]}".strip().lower(),
                now,
                product_id,
            )
            for product_id, brand in found.items()
        ]

        phase = time.monotonic()
        print(f"Applying {len(updates):,} brand updates in one transaction...", flush=True)
        db.execute("BEGIN IMMEDIATE")
        try:
            db.executemany("""
              UPDATE cannabis_products
              SET brand_name=?, normalized_name=?, updated_at=?
              WHERE id=? AND (brand_name IS NULL OR TRIM(brand_name)='')
            """, updates)
            db.commit()
        except Exception:
            db.rollback()
            raise

        changed = int(db.execute("SELECT changes()").fetchone()[0])
        print(f"Applied {len(updates):,} attempted brand backfills ({time.monotonic()-phase:.1f}s write phase).")
        print(f"BACKFILL COMPLETE in {elapsed(started)}.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
