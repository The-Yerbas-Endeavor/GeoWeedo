#!/usr/bin/env python3
"""Targeted Cannlytics product reconciliation for GeoWeedo.

Dry-run by default. With --apply this command:
- refuses to run while a Cannlytics importer/runner is active;
- creates a SQLite backup first;
- migrates deterministic cp-cann-* product IDs only when the expected ID does
  not already exist and the product has one unambiguous current identity;
- repoints every discovered foreign-key reference to cannabis_products(id),
  plus loose product_id columns used by older schema versions;
- deletes only completely unreferenced cp-cann-* products;
- runs PRAGMA foreign_key_check before commit.

Ambiguous multi-producer products are never changed automatically.
"""
import argparse
import hashlib
import os
import re
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd()
DEFAULT_DB = ROOT / "data" / "runtime" / "geoweedo.sqlite"
DEFAULT_BACKUP_DIR = Path.home() / "geoweedo-db-backups"


def norm(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def stable_hash(prefix, value, length=24):
    return prefix + hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def quote_ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def cannlytics_worker_processes():
    if not sys.platform.startswith("linux"):
        return []
    matches = []
    proc = Path("/proc")
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            cmdline = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
        except Exception:
            continue
        low = cmdline.lower()
        if (
            "import-cannlytics" in low
            or ("run-weedo-source-update.mjs" in low and "cannlytics" in low)
        ) and int(entry.name) != os.getpid():
            matches.append((int(entry.name), cmdline.strip()))
    return sorted(matches)


def table_names(db):
    return [
        str(row[0])
        for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    ]


def product_references(db):
    """Return unique (table, column) pairs that may contain cannabis product IDs."""
    refs = set()
    for table in table_names(db):
        qtable = quote_ident(table)
        try:
            for fk in db.execute(f"PRAGMA foreign_key_list({qtable})").fetchall():
                # (id,seq,table,from,to,on_update,on_delete,match)
                target_table = str(fk[2] or "")
                from_column = str(fk[3] or "")
                to_column = str(fk[4] or "")
                if target_table == "cannabis_products" and to_column == "id" and from_column:
                    refs.add((table, from_column))
        except sqlite3.DatabaseError:
            pass

        try:
            columns = {str(row[1]) for row in db.execute(f"PRAGMA table_info({qtable})").fetchall()}
        except sqlite3.DatabaseError:
            columns = set()
        if table != "cannabis_products" and "product_id" in columns:
            refs.add((table, "product_id"))
    return sorted(refs)


def count_refs(db, product_id, refs):
    found = []
    total = 0
    for table, column in refs:
        row = db.execute(
            f"SELECT COUNT(*) FROM {quote_ident(table)} WHERE {quote_ident(column)}=?",
            (product_id,),
        ).fetchone()
        count = int(row[0] or 0)
        if count:
            found.append((table, column, count))
            total += count
    return total, found


def build_identity_context(db):
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
    return products


def deterministic_mismatches(db):
    mismatches = []
    ambiguous = []
    for context in build_identity_context(db).values():
        brand = context["brand"]
        producers = context["producers"]
        if brand:
            owner_kind = "brand"
            owner = brand
        elif len(producers) == 1:
            owner_kind = "producer"
            owner = next(iter(producers))
        elif len(producers) > 1:
            ambiguous.append(context)
            continue
        else:
            # Cannot safely derive the importer's owner identity.
            continue
        expected_id = stable_hash(
            "cp-cann-",
            "|".join([owner, context["product_name"], context["product_type"]]),
        )
        if context["product_id"].startswith("cp-cann-") and context["product_id"] != expected_id:
            mismatches.append({
                **context,
                "owner_kind": owner_kind,
                "owner": owner,
                "expected_id": expected_id,
            })
    mismatches.sort(key=lambda row: (-row["batch_count"], row["product_name"], row["product_id"]))
    return mismatches, ambiguous


def fully_unreferenced_cannlytics_products(db, refs):
    candidates = db.execute("""
      SELECT id,brand_name,product_name,product_type
      FROM cannabis_products
      WHERE id LIKE 'cp-cann-%'
      ORDER BY product_name COLLATE NOCASE,id
    """).fetchall()
    orphaned = []
    for row in candidates:
        total, details = count_refs(db, str(row["id"]), refs)
        if total == 0:
            orphaned.append({
                "product_id": str(row["id"]),
                "brand_name": row["brand_name"],
                "product_name": row["product_name"],
                "product_type": row["product_type"],
            })
    return orphaned


def create_backup(db_path, backup_dir):
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = backup_dir / f"geoweedo.sqlite.pre-cannlytics-reconcile-{timestamp}.bak"

    usage = shutil.disk_usage(backup_dir)
    required = db_path.stat().st_size + 512 * 1024 * 1024
    if usage.free < required:
        raise RuntimeError(
            f"Not enough free disk space for a safe backup: {usage.free / (1024**3):.2f} GiB free; "
            f"need at least {required / (1024**3):.2f} GiB."
        )

    source = sqlite3.connect(db_path, timeout=120)
    destination = sqlite3.connect(backup_path)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    return backup_path


def clone_product_to_id(db, old_id, new_id):
    columns = [str(row[1]) for row in db.execute('PRAGMA table_info("cannabis_products")').fetchall()]
    if "id" not in columns:
        raise RuntimeError("cannabis_products.id is missing")
    non_id = [column for column in columns if column != "id"]
    insert_columns = ["id", *non_id]
    select_parts = ["?", *[quote_ident(column) for column in non_id]]
    sql = (
        f"INSERT INTO cannabis_products ({','.join(quote_ident(c) for c in insert_columns)}) "
        f"SELECT {','.join(select_parts)} FROM cannabis_products WHERE id=?"
    )
    cursor = db.execute(sql, (new_id, old_id))
    if cursor.rowcount != 1:
        raise RuntimeError(f"Unable to clone product {old_id} to {new_id}")


def migrate_product_id(db, old_id, new_id, refs):
    if db.execute("SELECT 1 FROM cannabis_products WHERE id=?", (new_id,)).fetchone():
        raise RuntimeError(f"Expected product ID {new_id} already exists; refusing automatic merge")

    clone_product_to_id(db, old_id, new_id)
    moved = []
    for table, column in refs:
        cursor = db.execute(
            f"UPDATE {quote_ident(table)} SET {quote_ident(column)}=? WHERE {quote_ident(column)}=?",
            (new_id, old_id),
        )
        if cursor.rowcount:
            moved.append((table, column, cursor.rowcount))

    remaining, details = count_refs(db, old_id, refs)
    if remaining:
        formatted = ", ".join(f"{table}.{column}={count}" for table, column, count in details)
        raise RuntimeError(f"References to old product {old_id} remain after migration: {formatted}")

    deleted = db.execute("DELETE FROM cannabis_products WHERE id=?", (old_id,)).rowcount
    if deleted != 1:
        raise RuntimeError(f"Unable to remove legacy product {old_id} after migration")
    return moved


def main():
    parser = argparse.ArgumentParser(description="Safely reconcile narrow Cannlytics product identity cleanup candidates.")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--backup-dir", default=str(DEFAULT_BACKUP_DIR))
    parser.add_argument("--apply", action="store_true", help="Apply the safe reconciliation. Default is dry-run.")
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    backup_dir = Path(args.backup_dir).expanduser().resolve()
    if not db_path.exists():
        raise SystemExit(f"GeoWeedo database not found: {db_path}")

    workers = cannlytics_worker_processes()
    if workers:
        print("Active Cannlytics process(es) detected:")
        for pid, command in workers:
            print(f"  PID {pid}: {command}")
        if args.apply:
            raise SystemExit("Refusing --apply while Cannlytics is running. Stop the importer first.")
        print("Dry-run will continue, but do not apply cleanup until the importer is stopped.\n")

    db = sqlite3.connect(db_path, timeout=120)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    refs = product_references(db)
    mismatches, ambiguous = deterministic_mismatches(db)
    orphans = fully_unreferenced_cannlytics_products(db, refs)

    print("Cannlytics targeted product reconciliation")
    print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'}")
    print(f"Database: {db_path}")
    print(f"Discovered product reference columns: {len(refs)}")
    for table, column in refs:
        print(f"  - {table}.{column}")

    print(f"\nDeterministic-ID mismatch(es): {len(mismatches)}")
    for item in mismatches:
        expected_exists = bool(db.execute("SELECT 1 FROM cannabis_products WHERE id=?", (item["expected_id"],)).fetchone())
        ref_total, details = count_refs(db, item["product_id"], refs)
        print(
            f"  - {item['product_id']} -> {item['expected_id']} | owner={item['owner_kind']}:{item['owner']} | "
            f"product={item['product_name']} | type={item['product_type']} | batches={item['batch_count']} | "
            f"refs={ref_total} | expected_exists={'yes' if expected_exists else 'no'}"
        )
        for table, column, count in details:
            print(f"      {table}.{column}: {count}")

    print(f"\nAmbiguous multi-producer Cannlytics product(s), intentionally untouched: {len(ambiguous)}")
    for item in ambiguous:
        print(
            f"  - {item['product_id']} | product={item['product_name']} | type={item['product_type']} | "
            f"producers={len(item['producers'])} | batches={item['batch_count']}"
        )

    print(f"\nCompletely unreferenced Cannlytics-created product(s): {len(orphans)}")
    for item in orphans:
        print(f"  - {item['product_id']} | {item['brand_name'] or ''} | {item['product_name']} | {item['product_type'] or ''}")

    if not args.apply:
        print("\nDRY RUN ONLY — no database changes were made.")
        print("After review, run again with --apply while the Cannlytics importer is stopped.")
        db.close()
        return 0

    # Every deterministic mismatch must be safe to migrate; otherwise make no changes.
    blocked = [
        item for item in mismatches
        if db.execute("SELECT 1 FROM cannabis_products WHERE id=?", (item["expected_id"],)).fetchone()
    ]
    if blocked:
        db.close()
        raise SystemExit(
            "Refusing --apply because at least one expected product ID already exists. "
            "That case requires manual merge review."
        )

    db.close()
    backup_path = create_backup(db_path, backup_dir)
    print(f"\nBackup created: {backup_path}")

    db = sqlite3.connect(db_path, timeout=120)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        db.execute("BEGIN IMMEDIATE")
        refs = product_references(db)
        current_mismatches, current_ambiguous = deterministic_mismatches(db)
        if current_ambiguous:
            print(f"Leaving {len(current_ambiguous)} ambiguous multi-producer product(s) untouched.")

        for item in current_mismatches:
            print(f"Migrating {item['product_id']} -> {item['expected_id']}...")
            moved = migrate_product_id(db, item["product_id"], item["expected_id"], refs)
            for table, column, count in moved:
                print(f"  moved {count} reference(s): {table}.{column}")

        # Recompute after ID migration; delete only products with absolutely no references.
        current_orphans = fully_unreferenced_cannlytics_products(db, refs)
        for item in current_orphans:
            deleted = db.execute("DELETE FROM cannabis_products WHERE id=?", (item["product_id"],)).rowcount
            if deleted:
                print(f"Deleted fully unreferenced product: {item['product_id']} | {item['product_name']}")

        fk_issues = db.execute("PRAGMA foreign_key_check").fetchall()
        if fk_issues:
            sample = "; ".join(str(tuple(row)) for row in fk_issues[:10])
            raise RuntimeError(f"Foreign-key check failed ({len(fk_issues)} issue(s)): {sample}")

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    verify = sqlite3.connect(db_path, timeout=120)
    verify.row_factory = sqlite3.Row
    remaining_mismatches, remaining_ambiguous = deterministic_mismatches(verify)
    remaining_orphans = fully_unreferenced_cannlytics_products(verify, product_references(verify))
    verify.close()

    print("\nReconciliation complete.")
    print(f"Remaining deterministic-ID mismatches: {len(remaining_mismatches)}")
    print(f"Remaining completely unreferenced cp-cann products: {len(remaining_orphans)}")
    print(f"Ambiguous multi-producer products left for review: {len(remaining_ambiguous)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
