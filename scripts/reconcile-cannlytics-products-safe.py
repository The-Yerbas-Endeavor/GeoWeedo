#!/usr/bin/env python3
"""Strict Cannlytics product reconciliation.

Dry-run by default. With --apply this command:
- refuses to run while Cannlytics is active;
- creates a SQLite backup first;
- discovers every product_id reference in the schema;
- reconciles deterministic cp-cann-* IDs;
- may merge a legacy product into an already-existing canonical target ONLY when
  that target independently resolves to the exact same normalized Cannlytics
  brand-or-producer + product-name + product-type identity;
- deletes only cp-cann-* products with zero references anywhere;
- leaves ambiguous multi-producer products untouched;
- runs PRAGMA foreign_key_check before commit.
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
    return [str(r[0]) for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]


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
            cols = {str(r[1]) for r in db.execute(f"PRAGMA table_info({qt})")}
        except sqlite3.DatabaseError:
            cols = set()
        if table != "cannabis_products" and "product_id" in cols:
            refs.add((table, "product_id"))
    return sorted(refs)


def count_refs(db, product_id, refs):
    total = 0
    details = []
    for table, column in refs:
        count = int(db.execute(
            f"SELECT COUNT(*) FROM {q(table)} WHERE {q(column)}=?", (product_id,)
        ).fetchone()[0] or 0)
        if count:
            details.append((table, column, count))
            total += count
    return total, details


def product_identity(db, product_id):
    rows = db.execute("""
      SELECT p.id,p.brand_name,p.product_name,p.product_type,b.producer_name
      FROM cannabis_products p
      LEFT JOIN cannabis_batches b
        ON b.product_id=p.id AND b.source_name='Cannlytics'
      WHERE p.id=?
    """, (product_id,)).fetchall()
    if not rows:
        return None

    brand = norm(rows[0][1])
    name = norm(rows[0][2])
    product_type = norm(rows[0][3])
    producers = {norm(r[4]) for r in rows if norm(r[4])}
    batch_count = sum(1 for r in rows if r[4] is not None)

    if brand:
        owner_kind, owner = "brand", brand
    elif len(producers) == 1:
        owner_kind, owner = "producer", next(iter(producers))
    elif len(producers) > 1:
        return {
            "product_id": product_id,
            "ambiguous": True,
            "brand": brand,
            "product_name": name,
            "product_type": product_type,
            "producers": producers,
            "batch_count": batch_count,
        }
    else:
        return {
            "product_id": product_id,
            "ambiguous": True,
            "brand": brand,
            "product_name": name,
            "product_type": product_type,
            "producers": producers,
            "batch_count": batch_count,
        }

    identity_key = (owner, name, product_type)
    expected_id = stable_hash("cp-cann-", "|".join(identity_key))
    return {
        "product_id": product_id,
        "ambiguous": False,
        "owner_kind": owner_kind,
        "owner": owner,
        "product_name": name,
        "product_type": product_type,
        "producers": producers,
        "batch_count": batch_count,
        "identity_key": identity_key,
        "expected_id": expected_id,
    }


def deterministic_state(db):
    ids = [str(r[0]) for r in db.execute("""
      SELECT DISTINCT p.id
      FROM cannabis_products p
      JOIN cannabis_batches b ON b.product_id=p.id
      WHERE b.source_name='Cannlytics' AND p.id LIKE 'cp-cann-%'
      ORDER BY p.id
    """)]
    mismatches = []
    ambiguous = []
    for product_id in ids:
        item = product_identity(db, product_id)
        if not item:
            continue
        if item["ambiguous"]:
            ambiguous.append(item)
        elif item["expected_id"] != product_id:
            mismatches.append(item)
    return mismatches, ambiguous


def target_is_same_identity(db, source):
    target = product_identity(db, source["expected_id"])
    if not target or target.get("ambiguous"):
        return False, target
    return target.get("identity_key") == source.get("identity_key"), target


def fully_unreferenced(db, refs):
    result = []
    for row in db.execute("""
      SELECT id,brand_name,product_name,product_type
      FROM cannabis_products
      WHERE id LIKE 'cp-cann-%'
      ORDER BY product_name COLLATE NOCASE,id
    """):
        total, _ = count_refs(db, str(row[0]), refs)
        if total == 0:
            result.append({
                "product_id": str(row[0]),
                "brand_name": row[1],
                "product_name": row[2],
                "product_type": row[3],
            })
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
    src = sqlite3.connect(db_path, timeout=120)
    dst = sqlite3.connect(out)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return out


def clone_product(db, old_id, new_id):
    columns = [str(r[1]) for r in db.execute('PRAGMA table_info("cannabis_products")')]
    non_id = [c for c in columns if c != "id"]
    sql = (
        f"INSERT INTO cannabis_products ({','.join(q(c) for c in ['id', *non_id])}) "
        f"SELECT ?,{','.join(q(c) for c in non_id)} FROM cannabis_products WHERE id=?"
    )
    if db.execute(sql, (new_id, old_id)).rowcount != 1:
        raise RuntimeError(f"Could not clone {old_id} to {new_id}")


def move_references(db, old_id, new_id, refs):
    moved = []
    for table, column in refs:
        cur = db.execute(
            f"UPDATE {q(table)} SET {q(column)}=? WHERE {q(column)}=?",
            (new_id, old_id),
        )
        if cur.rowcount:
            moved.append((table, column, int(cur.rowcount)))
    remaining, details = count_refs(db, old_id, refs)
    if remaining:
        text = ", ".join(f"{t}.{c}={n}" for t, c, n in details)
        raise RuntimeError(f"References remain on {old_id}: {text}")
    return moved


def reconcile_one(db, item, refs):
    old_id = item["product_id"]
    new_id = item["expected_id"]
    exists = bool(db.execute("SELECT 1 FROM cannabis_products WHERE id=?", (new_id,)).fetchone())

    if exists:
        same, target = target_is_same_identity(db, item)
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


def main():
    ap = argparse.ArgumentParser(description="Safely reconcile Cannlytics product identities.")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--backup-dir", default=str(DEFAULT_BACKUP_DIR))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

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

    db = sqlite3.connect(db_path, timeout=120)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    refs = product_refs(db)
    mismatches, ambiguous = deterministic_state(db)
    orphans = fully_unreferenced(db, refs)

    print("Cannlytics targeted product reconciliation v2")
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
            f"type={item['product_type']} | refs={ref_total} | "
            f"target={'existing verified identity' if target_exists and same_target else 'existing BLOCKED' if target_exists else 'new ID'}"
        )
        for table, column, count in details:
            print(f"      {table}.{column}: {count}")

    print(f"\nAmbiguous multi-producer product(s), untouched: {len(ambiguous)}")
    for item in ambiguous:
        print(
            f"  - {item['product_id']} | product={item['product_name']} | type={item['product_type']} | "
            f"producers={len(item['producers'])} | batches={item['batch_count']}"
        )

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
        current, current_ambiguous = deterministic_state(db)
        if current_ambiguous:
            print(f"Leaving {len(current_ambiguous)} ambiguous product(s) untouched.")

        for item in current:
            action, moved = reconcile_one(db, item, refs)
            print(f"{action.title()}d {item['product_id']} -> {item['expected_id']}")
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
    remaining, remaining_ambiguous = deterministic_state(verify)
    remaining_orphans = fully_unreferenced(verify, product_refs(verify))
    verify.close()

    print("\nReconciliation complete.")
    print(f"Remaining deterministic-ID mismatches: {len(remaining)}")
    print(f"Remaining completely unreferenced cp-cann products: {len(remaining_orphans)}")
    print(f"Ambiguous multi-producer products left for review: {len(remaining_ambiguous)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
