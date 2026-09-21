#!/usr/bin/env python3
"""Backfill missing cannabis product brands from trusted existing GeoWeedo evidence.

Priority:
1. Brand already captured with a QR scan.
2. Explicit brand-like fields preserved in Cannlytics raw provenance.
3. Conservative brand patterns embedded in a product title.

Dry-run by default. Pass --apply to persist changes.
"""

import argparse
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path.cwd() / "data" / "runtime" / "geoweedo.sqlite"

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
    text = clean(product_name)
    if not text:
        return None

    bracket = re.match(r"^\[([^\]]{2,60})\]\s*(?:[-|:])", text)
    if bracket:
        return clean(bracket.group(1))

    if " | " in text:
        prefix = clean(text.split(" | ", 1)[0])
        if prefix and len(prefix) <= 60:
            return prefix

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


def columns(db, table):
    if not has_table(db, table):
        return set()
    return {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def qr_brand(db, product_id):
    cols = columns(db, "cannabis_qr_scans")
    if not {"product_id", "brand_name", "last_seen_at"} <= cols:
        return None
    row = db.execute("""
      SELECT brand_name
      FROM cannabis_qr_scans
      WHERE product_id=?
        AND brand_name IS NOT NULL
        AND TRIM(brand_name)<>''
      ORDER BY last_seen_at DESC
      LIMIT 1
    """, (product_id,)).fetchone()
    return clean(row[0]) if row else None


def cannlytics_brand(db, product_id):
    if not has_table(db, "cannabis_coa_sources") or not has_table(db, "cannabis_batches"):
        return None
    rows = db.execute("""
      SELECT s.raw_payload_json
      FROM cannabis_batches b
      JOIN cannabis_coa_sources s ON s.batch_id=b.id
      WHERE b.product_id=?
        AND s.source_name='Cannlytics'
        AND s.raw_payload_json IS NOT NULL
      ORDER BY COALESCE(s.fetched_at,s.created_at) DESC
      LIMIT 20
    """, (product_id,)).fetchall()
    for row in rows:
        try:
            payload = json.loads(row[0])
        except Exception:
            continue
        source = payload.get("row") if isinstance(payload, dict) and isinstance(payload.get("row"), dict) else payload
        if not isinstance(source, dict):
            continue
        normalized = {key_name(k): v for k, v in source.items()}
        for key in BRAND_KEYS:
            value = clean(normalized.get(key_name(key)))
            if value:
                return value
    return None


def main():
    parser = argparse.ArgumentParser(description="Backfill missing GeoWeedo product brands.")
    parser.add_argument("--apply", action="store_true", help="Persist brand updates.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum missing-brand products to inspect.")
    args = parser.parse_args()

    if not DB_PATH.exists():
        raise SystemExit(f"GeoWeedo database not found: {DB_PATH}")

    db = sqlite3.connect(DB_PATH, timeout=60)
    db.row_factory = sqlite3.Row
    rows = db.execute("""
      SELECT id,product_name,brand_name
      FROM cannabis_products
      WHERE brand_name IS NULL OR TRIM(brand_name)=''
      ORDER BY updated_at DESC, product_name COLLATE NOCASE
    """).fetchall()
    if args.limit > 0:
        rows = rows[:args.limit]

    found = []
    by_source = {"qr_scan": 0, "cannlytics": 0, "product_title": 0}

    for row in rows:
        product_id = str(row["id"])
        product_name = clean(row["product_name"]) or ""
        brand = qr_brand(db, product_id)
        source = "qr_scan" if brand else None

        if not brand:
            brand = cannlytics_brand(db, product_id)
            source = "cannlytics" if brand else None

        if not brand:
            brand = infer_brand_from_product_name(product_name)
            source = "product_title" if brand else None

        if not brand or not source:
            continue

        found.append((product_id, product_name, brand, source))
        by_source[source] += 1

    print(f"Missing-brand products inspected: {len(rows):,}")
    print(f"Recoverable brands: {len(found):,}")
    print(
        "Sources: "
        f"QR scan={by_source['qr_scan']:,}, "
        f"Cannlytics provenance={by_source['cannlytics']:,}, "
        f"title inference={by_source['product_title']:,}"
    )

    for product_id, product_name, brand, source in found[:50]:
        print(f"  {brand} | {product_name} | {product_id} | {source}")
    if len(found) > 50:
        print(f"  ... {len(found)-50:,} more")

    if not args.apply:
        print("\nDRY RUN ONLY — rerun with --apply to persist these brands.")
        db.close()
        return

    now = datetime.now(timezone.utc).isoformat()
    db.execute("BEGIN IMMEDIATE")
    try:
        for product_id, product_name, brand, _source in found:
            normalized = f"{brand} {product_name}".strip().lower()
            db.execute("""
              UPDATE cannabis_products
              SET brand_name=?, normalized_name=?, updated_at=?
              WHERE id=? AND (brand_name IS NULL OR TRIM(brand_name)='')
            """, (brand, normalized, now, product_id))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(f"\nApplied {len(found):,} brand backfill(s).")


if __name__ == "__main__":
    main()
