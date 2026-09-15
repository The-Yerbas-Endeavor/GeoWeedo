#!/usr/bin/env python3
"""Fast, strict Cannlytics product reconciliation for GeoWeedo.

Dry-run by default. With --apply this command:
- refuses to run while Cannlytics is active;
- creates a SQLite backup first;
- discovers every product_id reference in the schema;
- reconciles deterministic cp-cann-* IDs;
- may merge a legacy product into an already-existing canonical target only when
  that target independently resolves to the same normalized identity;
- deletes only cp-cann-* products with zero references anywhere;
- leaves multi-producer and missing-owner identities untouched;
- runs PRAGMA foreign_key_check before commit.

This version deliberately avoids per-product SQL loops. Identity state is built
in one batch query and orphan detection uses one DISTINCT query per reference
column, so a dry run stays fast even with tens of thousands of products.
"""
import argparse
import hashlib
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd()
DEFAULT_DB = ROOT / "data" / "runtime" / "geoweedo.sqlite"
DEFAULT_BACKUP_DIR = Path.home() / "geoweedo-db-backups"


def norm(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def stable_hash(prefix, value, length=24):
    return prefix + hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def q(value):
    return '"' + str(value).replace('"', '""') + '"'


def cannlytics_workers():
    if not sys.platform.startswith("linux"):
        return []
    found = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            cmd = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
        except Exception:
            continue
        low = cmd.lower()
        if int(entry.name) != os.getpid() and (
            "import-cannlytics" in low
            or ("run-weedo-source-update.mjs" in low and "cannlytics" in low)
        ):
            found.append((int(entry.name), cmd.strip()))
    return sorted(found)


def tables(db):
    return [
        str(row[0])
        for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def product_refs(db):
    refs = set()
    for table in tables(db):
        qt = q(table)
        try:
            for fk in db.execute(f"PRAGMA foreign_key_list({qt})"):
                if str(fk[2] or "") == "cannabis_products" and str(fk[4] or "") == "id" and fk[3]:
                    refs.add((table, str(fk[3])))
        except sqlite3.DatabaseError:
            pass
        try:
            cols = {str(row[1]) for row in db.execute(f"PRAGMA table_info({qt})")}
        except sqlite3.DatabaseError:
            cols = set()
        if table != "cannabis_products" and "product_id" in cols:
            refs.add((table, "product_id"))
    return sorted(refs)


def count_refs(db, product_id, refs):
    total = 0
    details = []
    for table, column in refs:
        count = int(
            db.execute(
                f"SELECT COUNT(*) FROM {q(table)} WHERE {q(column)}=?",
                (product_id,),
            ).fetchone()[0]
            or 0
        )
        if count:
            total += count
            details.append((table, column, count))
    return total, details


def classify_identity(context):
    brand = context["brand"]
    producers = context["producers"]
    if brand:
        owner_kind, owner = "brand", brand
    elif len(producers) == 1:
        owner_kind, owner = "producer", next(iter(producers))
    elif len(producers) > 1:
        return {**context, "state": "multi_producer"}
    else:
        return {**context, "state": "missing_owner"}

    identity_key = (owner, context["product_name"], context["product_type"])
    return {
        **context,
        "state": "resolved",
        "owner_kind": owner_kind,
        "owner": owner,
        "identity_key": identity_key,
        "expected_id": stable_hash("cp-cann-", "|".join(identity_key)),
    }


def deterministic_state(db):
    """Build all Cannlytics product identity state in one query."""
    contexts = {}
    for row in db.execute("""
      SELECT p.id,p.brand_name,p.product_name,p.product_type,b.id,b.producer_name
      FROM cannabis_batches b
      JOIN cannabis_products p ON p.id=b.product_id
      WHERE b.source_name='Cannlytics' AND p.id LIKE 'cp-cann-%'
      ORDER BY p.id
    """):
        product_id = str(row[0])
        item = contexts.setdefault(
            product_id,
            {
                "product_id": product_id,
                "brand": norm(row[1]),
                "product_name": norm(row[2]),
                "product_type": norm(row[3]),
                "producers": set(),
                "batch_count": 0,
            },
        )
        item["batch_count"] += 1
        producer = norm(row[5])
        if producer:
            item["producers"].add(producer)

    mismatches = []
    multi_producer = []
    missing_owner = []
    for context in contexts.values():
        item = classify_identity(context)
        if item["state"] == "multi_producer":
            multi_producer.append(item)
        elif item["state"] == "missing_owner":
            missing_owner.append(item)
        elif item["expected_id"] != item["product_id"]:
            mismatches.append(item)

    mismatches.sort(key=lambda x: (-x["batch_count"], x["product_name"], x["product_id"]))
    multi_producer.sort(key=lambda x: (-len(x["producers"]), -x["batch_count"], x["product_name"]))
    missing_owner.sort(key=lambda x: (-x["batch_count"], x["product_name"], x["product_id"]))
    return mismatches, multi_producer, missing_owner


def product_identity(db, product_id):
    """Resolve one product independently, used only to verify an existing merge target."""
    rows = db.execute("""
      SELECT p.id,p.brand_name,p.product_name,p.product_type,b.id,b.producer_name
      FROM cannabis_products p
      LEFT JOIN cannabis_batches b
        ON b.product_id=p.id AND b.source_name='Cannlytics'
      WHERE p.id=?
    """, (product_id,)).fetchall()
    if not rows:
        return None

    context = {
        "product_id": product_id,
        "brand": norm(rows[0][1]),
        "product_name": norm(rows[0][2]),
        "product_type": norm(rows[0][3]),
        "producers": set(),
        "batch_count": 0,
    }
    for row in rows:
        if row[4] is not None:
            context["batch_count"] += 1
        producer = norm(row[5])
        if producer:
            context["producers"].add(producer)
    return classify_identity(context)


def target_is_same_identity(db, source):
    target = product_identity(db, source["expected_id"])
    if not target or target.get("state") != "resolved":
        return False, target
    return target.get("identity_key") == source.get("identity_key"), target


def fully_unreferenced(db, refs):
    """Find cp-cann products with zero references using set scans, not N x table COUNT queries."""
    products = {}
    for row in db.execute("""
      SELECT id,brand_name,product_name,product_type
      FROM cannabis_products
      WHERE id LIKE 'cp-cann-%'
    """):
        products[str(row[0])] = {
            "product_id": str(row[0]),
            "brand_name": row[1],
            "product_name": row[2],
            "product_type": row[3],
        }

    referenced = set()
    for table, column in refs:
        sql = (
            f"SELECT DISTINCT {q(column)} FROM {q(table)} "
            f"WHERE {q(column)} LIKE 'cp-cann-%'"
        )
        try:
            referenced.update(str(row[0]) for row in db.execute(sql) if row[0])
        except sqlite3.DatabaseError:
            # Discovery is intentionally broader than FK metadata; if a legacy
            # loose product_id column cannot be read, fail closed by skipping
            # deletion rather than guessing that products are unreferenced.
            return []

    result = [products[pid] for pid in products.keys() - referenced]
    result.sort(key=lambda x: ((x["product_name"] or "").lower(), x["product_id"]))
    return result


def create_backup(db_path, backup_dir):
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out = backup_dir / f"geoweedo.sqlite.pre-cannlytics-reconcile-{stamp}.bak"
    required = db_path.stat().st_size + 512 * 1024 * 1024
    free = shutil.disk_usage(backup_dir).free
    if free < required:
        raise RuntimeError(
            f"Not enough free space for backup: {free/(1024**3):.2f} GiB free; "
            f"need {required/(1024**3):.2f} GiB."
        )
    source = sqlite3.connect(db_path, timeout=120)
    destination = sqlite3.connect(out)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    return out


def clone_product(db, old_id, new_id):
    columns = [str(row[1]) for row in db.execute('PRAGMA table_info("cannabis_products")')]
    non_id = [column for column in columns if column != "id"]
    sql = (
        f"INSERT INTO cannabis_products ({','.join(q(c) for c in ['id', *non_id])}) "
        f"SELECT ?,{','.join(q(c) for c in non_id)} FROM cannabis_products WHERE id=?"
    )
    if db.execute(sql, (new_id, old_id)).rowcount != 1:
        raise RuntimeError(f"Could not clone {old_id} to {new_id}")


def move_references(db, old_id, new_id, refs):
    moved = []
    for table, column in refs:
        cursor = db.execute(
            f"UPDATE {q(table)} SET {q(column)}=? WHERE {q(column)}=?",
            (new_id, old_id),
        )
        if cursor.rowcount:
            moved.append((table, column, int(cursor.rowcount)))
    remaining, details = count_refs(db, old_id, refs)
    if remaining:
        text = ", ".join(f"{table}.{column}={count}" for table, column, count in details)
        raise RuntimeError(f"References remain on {old_id}: {text}")
    return moved


def reconcile_one(db, item, refs):
    old_id = item["product_id"]
    new_id = item["expected_id"]
    exists = bool(db.execute("SELECT 1 FROM cannabis_products WHERE id=?", (new_id,)).fetchone())
    if exists:
        same, _target = target_is_same_identity(db, item)
        if not same:
            raise RuntimeError(
                f"Target {new_id} exists but does not independently resolve to the same Cannlytics identity; refusing merge"
            )
    else:
        clone_product(db, old_id, new_id)

    moved = move_references(db, old_id, new_id, refs)
    if db.execute("DELETE FROM cannabis_products WHERE id=?", (old_id,)).rowcount != 1:
        raise RuntimeError(f"Could not remove legacy product {old_id}")
    return "merge" if exists else "rename", moved


def print_limited(title, rows, formatter, limit):
    print(f"\n{title}: {len(rows):,}")
    for item in rows[:limit]:
        print("  - " + formatter(item))
    if len(rows) > limit:
        print(f"  ... {len(rows) - limit:,} more not shown (use --details-limit to increase)")


def main():
    parser = argparse.ArgumentParser(description="Safely reconcile Cannlytics product identities.")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--backup-dir", default=str(DEFAULT_BACKUP_DIR))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--details-limit", type=int, default=20, help="Rows shown per non-critical review section.")
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    backup_dir = Path(args.backup_dir).expanduser().resolve()
    if not db_path.exists():
        raise SystemExit(f"GeoWeedo database not found: {db_path}")

    workers = cannlytics_workers()
    if workers:
        print("Active Cannlytics process(es) detected:")
        for pid, cmd in workers:
            print(f"  PID {pid}: {cmd}")
        if args.apply:
            raise SystemExit("Refusing --apply while Cannlytics is running. Stop it first.")
        print("Dry-run continues, but do not apply until Cannlytics is stopped.\n")

    print("Scanning Cannlytics product identities...")
    db = sqlite3.connect(db_path, timeout=120)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    refs = product_refs(db)
    mismatches, multi_producer, missing_owner = deterministic_state(db)
    orphans = fully_unreferenced(db, refs)

    print("Cannlytics targeted product reconciliation v3")
    print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'}")
    print(f"Database: {db_path}")
    print(f"Discovered product reference columns: {len(refs)}")

    print(f"\nDeterministic-ID mismatch(es): {len(mismatches)}")
    blocked = []
    for item in mismatches:
        target_exists = bool(db.execute("SELECT 1 FROM cannabis_products WHERE id=?", (item["expected_id"],)).fetchone())
        same_target = None
        if target_exists:
            same_target, _ = target_is_same_identity(db, item)
            if not same_target:
                blocked.append(item)
        ref_total, details = count_refs(db, item["product_id"], refs)
        print(
            f"  - {item['product_id']} -> {item['expected_id']} | "
            f"owner={item['owner_kind']}:{item['owner']} | product={item['product_name']} | "
            f"type={item['product_type']} | batches={item['batch_count']} | refs={ref_total} | "
            f"target={'existing verified identity' if target_exists and same_target else 'existing BLOCKED' if target_exists else 'new ID'}"
        )
        for table, column, count in details:
            print(f"      {table}.{column}: {count}")

    print_limited(
        "Ambiguous multi-producer product(s), untouched",
        multi_producer,
        lambda item: (
            f"{item['product_id']} | product={item['product_name']} | type={item['product_type']} | "
            f"producers={len(item['producers'])} | batches={item['batch_count']}"
        ),
        max(0, args.details_limit),
    )

    print(f"\nMissing brand/producer identity, untouched: {len(missing_owner):,}")
    if missing_owner:
        print("  These have real Cannlytics batches but insufficient owner metadata for deterministic reconciliation.")
        for item in missing_owner[: min(5, max(0, args.details_limit))]:
            print(
                f"  - {item['product_id']} | product={item['product_name']} | "
                f"type={item['product_type']} | batches={item['batch_count']}"
            )
        if len(missing_owner) > min(5, max(0, args.details_limit)):
            shown = min(5, max(0, args.details_limit))
            print(f"  ... {len(missing_owner) - shown:,} more not shown")

    print(f"\nCompletely unreferenced cp-cann product(s): {len(orphans)}")
    for item in orphans:
        print(f"  - {item['product_id']} | {item['product_name']} | {item['product_type'] or ''}")

    if blocked:
        db.close()
        raise SystemExit("At least one existing target failed identity verification; no apply is allowed.")

    if not args.apply:
        print("\nDRY RUN ONLY — no database changes were made.")
        print("If this output is expected, rerun with --apply while Cannlytics is stopped.")
        db.close()
        return 0

    db.close()
    backup = create_backup(db_path, backup_dir)
    print(f"\nBackup created: {backup}")

    db = sqlite3.connect(db_path, timeout=120)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        db.execute("BEGIN IMMEDIATE")
        refs = product_refs(db)
        current, current_multi, current_missing = deterministic_state(db)
        if current_multi:
            print(f"Leaving {len(current_multi)} multi-producer product(s) untouched.")
        if current_missing:
            print(f"Leaving {len(current_missing)} missing-owner product(s) untouched.")

        for item in current:
            action, moved = reconcile_one(db, item, refs)
            verb = "Merged" if action == "merge" else "Renamed"
            print(f"{verb} {item['product_id']} -> {item['expected_id']}")
            for table, column, count in moved:
                print(f"  moved {count}: {table}.{column}")

        for item in fully_unreferenced(db, refs):
            if db.execute("DELETE FROM cannabis_products WHERE id=?", (item["product_id"],)).rowcount:
                print(f"Deleted fully unreferenced product: {item['product_id']} | {item['product_name']}")

        fk_issues = db.execute("PRAGMA foreign_key_check").fetchall()
        if fk_issues:
            raise RuntimeError(f"Foreign-key check failed with {len(fk_issues)} issue(s): {fk_issues[:10]}")
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    verify = sqlite3.connect(db_path, timeout=120)
    verify.row_factory = sqlite3.Row
    remaining, remaining_multi, remaining_missing = deterministic_state(verify)
    remaining_orphans = fully_unreferenced(verify, product_refs(verify))
    verify.close()

    print("\nReconciliation complete.")
    print(f"Remaining deterministic-ID mismatches: {len(remaining)}")
    print(f"Remaining completely unreferenced cp-cann products: {len(remaining_orphans)}")
    print(f"Multi-producer products left for review: {len(remaining_multi)}")
    print(f"Missing-owner products left untouched: {len(remaining_missing)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
