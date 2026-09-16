#!/usr/bin/env python3
"""Recover Cannlytics raw provenance for GeoWeedo missing-owner products.

Dry-run is the default. The recovery does not re-import products or rewrite
canonical data. It scans the current Cannlytics public datasets, reconstructs
GeoWeedo's stable external key and importer row hash, and only accepts rows
whose stored mapping and import-significant hash are compatible.

Because the historical importer intentionally stored raw_payload_json as NULL,
recovered payloads are wrapped with explicit recovery metadata instead of being
represented as an original historical capture.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd()
DEFAULT_DB = ROOT / "data" / "runtime" / "geoweedo.sqlite"
DEFAULT_CACHE = ROOT / "data" / "source-cache" / "cannlytics"
DEFAULT_BACKUP_DIR = Path.home() / "geoweedo-db-backups"
IMPORTER_PATH = Path(__file__).with_name("import-cannlytics-public.py")
PROVENANCE_VERSION = 1

GENERIC_PRODUCER_LABELS = {
    "processing", "processor", "cultivation", "cultivator", "manufacturing",
    "manufacturer", "production", "producer", "distribution", "distributor",
    "retail", "retailer", "licensee",
}
LOCATION_ONLY_PRODUCER = re.compile(
    r"^[^,]+,\s*[A-Z]{2}\s*,\s*\d{5}(?:-\d{4})?\s*,\s*(?:US|USA|UNITED STATES)$",
    re.IGNORECASE,
)

spec = importlib.util.spec_from_file_location("geoweedo_cannlytics_importer_for_backfill", IMPORTER_PATH)
if spec is None or spec.loader is None:
    raise SystemExit(f"Unable to load Cannlytics importer at {IMPORTER_PATH}")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def sanitized_producer(value):
    value = importer.clean(value)
    if not value:
        return None
    normalized = importer.norm(value)
    if normalized in GENERIC_PRODUCER_LABELS or LOCATION_ONLY_PRODUCER.fullmatch(value):
        return None
    return value


def cannlytics_workers():
    if not sys.platform.startswith("linux"):
        return []
    found = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            command = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
        except Exception:
            continue
        low = command.lower()
        if int(entry.name) != os.getpid() and (
            "import-cannlytics" in low
            or ("run-weedo-source-update.mjs" in low and "cannlytics" in low)
        ):
            found.append((int(entry.name), command.strip()))
    return sorted(found)


def create_backup(db_path, backup_dir):
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    output = backup_dir / f"geoweedo.sqlite.pre-cannlytics-raw-provenance-{stamp}.bak"
    required = db_path.stat().st_size + 512 * 1024 * 1024
    free = shutil.disk_usage(backup_dir).free
    if free < required:
        raise RuntimeError(
            f"Not enough free space for backup: {free/(1024**3):.2f} GiB free; "
            f"need {required/(1024**3):.2f} GiB."
        )
    source = sqlite3.connect(db_path, timeout=120)
    destination = sqlite3.connect(output)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    return output


def load_targets(db):
    """Load missing-owner products with bounded one-pass source-table scans."""
    product_rows = db.execute("""
      SELECT p.id AS product_id,p.product_name,b.id AS batch_id,b.producer_name
      FROM cannabis_products p
      JOIN cannabis_batches b ON b.product_id=p.id AND b.source_name='Cannlytics'
      WHERE p.id LIKE 'cp-cann-%'
        AND COALESCE(TRIM(p.brand_name),'')=''
    """)
    products = {}
    for row in product_rows:
        item = products.setdefault(str(row["product_id"]), {
            "product_name": row["product_name"],
            "batch_ids": set(),
            "has_producer": False,
        })
        item["batch_ids"].add(str(row["batch_id"]))
        if str(row["producer_name"] or "").strip():
            item["has_producer"] = True

    missing_products = {
        product_id: item for product_id, item in products.items() if not item["has_producer"]
    }
    target_batches = {
        batch_id
        for item in missing_products.values()
        for batch_id in item["batch_ids"]
    }

    source_records = {}
    state_counts = Counter()
    for row in db.execute("""
      SELECT external_key,state_code,source_record_id,row_hash,batch_id
      FROM cannlytics_source_records
      WHERE batch_id IS NOT NULL
    """):
        batch_id = str(row["batch_id"])
        if batch_id not in target_batches:
            continue
        external_key = str(row["external_key"])
        source_records[external_key] = {
            "external_key": external_key,
            "state_code": str(row["state_code"] or "").lower(),
            "source_record_id": str(row["source_record_id"] or ""),
            "row_hash": str(row["row_hash"] or ""),
            "batch_id": batch_id,
            "source_ids": [],
            "already_raw": 0,
        }
        state_counts[str(row["state_code"] or "").lower()] += 1

    for row in db.execute("""
      SELECT id,batch_id,external_id,raw_payload_json
      FROM cannabis_coa_sources
      WHERE source_name='Cannlytics' AND external_id IS NOT NULL
    """):
        external_key = str(row["external_id"])
        record = source_records.get(external_key)
        if not record or str(row["batch_id"] or "") != record["batch_id"]:
            continue
        if str(row["raw_payload_json"] or "").strip():
            record["already_raw"] += 1
        else:
            record["source_ids"].append(str(row["id"]))

    return missing_products, target_batches, source_records, state_counts


def producer_variants(row):
    raw = importer.pick(row, "producer", "producer_name", "cultivator", "manufacturer", "licensee")
    safe = sanitized_producer(raw)
    values = []
    for value in (raw, safe):
        if value not in values:
            values.append(value)
    return values


def source_identity(state, row, producer):
    product_name = importer.pick(row, "product_name", "strain_name", "product")
    if not product_name:
        return None
    sample_id = importer.pick(row, "sample_id", "lab_id")
    batch_number = importer.pick(row, "batch_number", "batch", "lot_number")
    record_id = importer.pick(row, "id", "sample_hash", "results_hash", "source_id")
    date_tested = importer.iso_date(importer.pick(row, "date_tested", "tested_at", "test_date"))
    if not (record_id or sample_id or batch_number):
        return None
    fallback = "|".join([
        state,
        product_name,
        producer or "",
        batch_number or "",
        sample_id or "",
        date_tested or "",
    ])
    source_record_id = record_id or importer.stable_hash("", fallback, 32)
    return {
        "external_key": f"{state}:{source_record_id}",
        "source_record_id": source_record_id,
        "product_name": product_name,
        "sample_id": sample_id,
        "batch_number": batch_number,
        "date_tested": date_tested,
    }


def importer_hash(state, row, producer, identity):
    producer_license = importer.pick(
        row, "producer_license_number", "producer_license", "license_number"
    )
    brand = importer.pick(row, "brand_name", "brand", "product_brand", "brand_owner")
    product_type = importer.pick(row, "product_type", "product_subtype", "category")
    lab = importer.pick(row, "lab", "lab_name", "laboratory")
    lab_license = importer.pick(row, "lab_license_number", "lab_license")
    source_label = importer.pick(row, "source") or f"Cannlytics {state.upper()}"
    analytes = importer.analytes_from_row(row)
    if not analytes:
        return None
    coa_url = importer.pick(row, "coa_url", "lab_results_url")
    source_url = coa_url or importer.DATASET_PAGE
    overall_status = importer.status_value(importer.pick(row, "overall_status", "status"))
    collected = importer.iso_date(importer.pick(row, "date_collected", "collected_at"))
    received = importer.iso_date(importer.pick(row, "date_received", "received_at"))
    payload = {
        "state": state,
        "external_id": identity["source_record_id"],
        "product_name": identity["product_name"],
        "product_type": product_type,
        "brand": brand,
        "producer": producer,
        "producer_license": producer_license,
        "batch_number": identity["batch_number"],
        "sample_id": identity["sample_id"],
        "lab": lab,
        "lab_license": lab_license,
        "tested_at": identity["date_tested"],
        "collected_at": collected,
        "received_at": received,
        "overall_status": overall_status,
        "source": source_label,
        "source_url": source_url,
        "analytes": analytes,
    }
    row_hash = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return row_hash


def read_snapshot_meta(cache_dir, state):
    path = cache_dir / f"{state}-results-latest.meta.json"
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def recovered_payload(row, *, state, external_key, row_hash, snapshot_meta):
    return json.dumps(
        {
            "_geoweedo_provenance": {
                "kind": "recovered_snapshot",
                "version": PROVENANCE_VERSION,
                "state": state.upper(),
                "external_key": external_key,
                "stored_import_hash": row_hash,
                "recovery_rule": "stable external key + compatible importer row hash",
                "dataset": importer.DATASET_PAGE,
                "snapshot_etag": snapshot_meta.get("etag"),
                "snapshot_last_modified": snapshot_meta.get("last_modified"),
                "snapshot_downloaded_at": snapshot_meta.get("downloaded_at"),
                "recovered_at": utcnow(),
            },
            "row": row,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def scan_upstream(source_records, cache_dir, states=None, progress_every=25000):
    wanted = {
        key: record
        for key, record in source_records.items()
        if record["source_ids"] and not record["already_raw"]
    }
    by_state = defaultdict(set)
    for key, record in wanted.items():
        by_state[record["state_code"]].add(key)

    selected_states = sorted(by_state)
    if states:
        allowed = {state.lower() for state in states}
        selected_states = [state for state in selected_states if state in allowed]

    recovered = {}
    seen_keys = set()
    hash_mismatches = {}
    state_summaries = {}

    for state in selected_states:
        target_keys = by_state[state]
        if not target_keys:
            continue
        if state not in importer.STATE_FILES:
            state_summaries[state] = {
                "target": len(target_keys), "scanned": 0, "seen": 0, "recovered": 0,
                "hash_mismatch": 0, "error": "state not supported by importer",
            }
            continue

        extension, upstream_records = importer.STATE_FILES[state]
        print(
            f"\n[{state.upper()}] Recovering {len(target_keys):,} target source record(s) "
            f"from {upstream_records:,} upstream observation(s)...",
            flush=True,
        )
        source_file, cached = importer.download_dataset(state, extension, cache_dir)
        print(
            f"[{state.upper()}] {'Using cached' if cached else 'Downloaded'} "
            f"{source_file.name} ({source_file.stat().st_size/(1024*1024):.1f} MiB)",
            flush=True,
        )
        snapshot_meta = read_snapshot_meta(cache_dir, state)

        scanned = state_seen = state_recovered = state_mismatch = 0
        for raw in importer.iter_rows(source_file):
            scanned += 1
            if progress_every and scanned % progress_every == 0:
                print(
                    f"[{state.upper()}] scanned={scanned:,} "
                    f"matched-key={state_seen:,}/{len(target_keys):,} "
                    f"recoverable={state_recovered:,} mismatched={state_mismatch:,}",
                    flush=True,
                )
            row = importer.normalized_row(raw)
            candidates = []
            for producer in producer_variants(row):
                identity = source_identity(state, row, producer)
                if identity and identity["external_key"] in target_keys:
                    candidates.append((producer, identity))
            if not candidates:
                continue

            unique_candidates = {}
            for producer, identity in candidates:
                unique_candidates.setdefault(identity["external_key"], (producer, identity))

            for external_key, first in unique_candidates.items():
                if external_key in seen_keys:
                    continue
                record = wanted[external_key]
                state_seen += 1
                seen_keys.add(external_key)

                producer_options = producer_variants(row)
                compatible = False
                computed_hashes = []
                for producer in producer_options:
                    identity = source_identity(state, row, producer)
                    if not identity or identity["external_key"] != external_key:
                        continue
                    row_hash = importer_hash(state, row, producer, identity)
                    if not row_hash:
                        continue
                    computed_hashes.append(row_hash)
                    if row_hash == record["row_hash"]:
                        recovered[external_key] = recovered_payload(
                            row,
                            state=state,
                            external_key=external_key,
                            row_hash=row_hash,
                            snapshot_meta=snapshot_meta,
                        )
                        compatible = True
                        state_recovered += 1
                        break

                if not compatible:
                    state_mismatch += 1
                    hash_mismatches[external_key] = {
                        "stored": record["row_hash"],
                        "computed": computed_hashes[:2],
                    }

        state_summaries[state] = {
            "target": len(target_keys),
            "scanned": scanned,
            "seen": state_seen,
            "recovered": state_recovered,
            "hash_mismatch": state_mismatch,
            "error": None,
        }
        print(
            f"[{state.upper()}] complete: seen={state_seen:,}/{len(target_keys):,} "
            f"recoverable={state_recovered:,} hash-mismatch={state_mismatch:,}",
            flush=True,
        )

    return recovered, seen_keys, hash_mismatches, state_summaries


def main():
    parser = argparse.ArgumentParser(
        description="Recover raw Cannlytics provenance for missing-owner GeoWeedo products."
    )
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE))
    parser.add_argument("--backup-dir", default=str(DEFAULT_BACKUP_DIR))
    parser.add_argument("--state", action="append", default=[], help="Limit to one or more state codes.")
    parser.add_argument("--apply", action="store_true", help="Persist only verified recovered raw provenance.")
    parser.add_argument("--progress-every", type=int, default=25000)
    parser.add_argument("--details-limit", type=int, default=15)
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    cache_dir = Path(args.cache_dir).resolve()
    if not db_path.exists():
        raise SystemExit(f"GeoWeedo database not found: {db_path}")

    if args.apply:
        workers = cannlytics_workers()
        if workers:
            print("Active Cannlytics process(es) detected:")
            for pid, command in workers:
                print(f"  PID {pid}: {command}")
            raise SystemExit("Refusing --apply while Cannlytics is running. Stop the importer first.")

    print("Loading missing-owner Cannlytics provenance targets...", flush=True)
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=120)
    db.row_factory = sqlite3.Row
    missing_products, target_batches, source_records, state_counts = load_targets(db)
    db.close()

    source_rows = len(source_records)
    already_raw = sum(1 for row in source_records.values() if row["already_raw"])
    missing_source_rows = sum(1 for row in source_records.values() if row["source_ids"] and not row["already_raw"])
    no_coa_source = sum(1 for row in source_records.values() if not row["source_ids"] and not row["already_raw"])

    print("Cannlytics raw provenance recovery v1")
    print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'}")
    print(f"Database: {db_path}")
    print(f"Missing-owner products: {len(missing_products):,}")
    print(f"Cannlytics batches represented: {len(target_batches):,}")
    print(f"Mapped Cannlytics source records: {source_rows:,}")
    print(f"Already carrying raw provenance: {already_raw:,}")
    print(f"Missing raw provenance and eligible for recovery: {missing_source_rows:,}")
    print(f"Mapped rows without a Cannlytics COA-source row: {no_coa_source:,}")
    if state_counts:
        print("Target source records by state:")
        for state, count in sorted(state_counts.items()):
            print(f"  - {state.upper() or '?'}: {count:,}")

    recovered, seen_keys, hash_mismatches, state_summaries = scan_upstream(
        source_records,
        cache_dir,
        states=args.state,
        progress_every=max(0, args.progress_every),
    )

    selected = {state.lower() for state in args.state}
    eligible_keys = {
        key for key, row in source_records.items()
        if row["source_ids"] and not row["already_raw"]
        and (not selected or row["state_code"] in selected)
    }
    not_found = eligible_keys - seen_keys
    write_rows = sum(len(source_records[key]["source_ids"]) for key in recovered)

    print("\nRecovery summary")
    print(f"Eligible source records scanned for recovery: {len(eligible_keys):,}")
    print(f"Stable external keys found upstream: {len(seen_keys & eligible_keys):,}")
    print(f"Hash-compatible source records: {len(recovered):,}")
    print(f"Hash-mismatched source records, untouched: {len(hash_mismatches):,}")
    print(f"Source records not found in current upstream snapshot, untouched: {len(not_found):,}")
    print(f"COA-source rows {'to update' if args.apply else 'that would be updated'}: {write_rows:,}")

    limit = max(0, args.details_limit)
    if hash_mismatches and limit:
        print("\nSample hash mismatches:")
        for key in sorted(hash_mismatches)[:limit]:
            print(f"  - {key}")
    if not_found and limit:
        print("\nSample source records no longer present upstream:")
        for key in sorted(not_found)[:limit]:
            print(f"  - {key}")

    print("\nSafety")
    print("  - No product IDs, names, brands, batches, analytes, menus, scans, or COA relationships are changed.")
    print("  - Recovery only fills currently blank cannabis_coa_sources.raw_payload_json values.")
    print("  - Every recovered row must match the stored stable external key and importer row hash.")
    print("  - Recovered payloads are explicitly labeled recovered_snapshot, not historical import captures.")
    print("  - Upstream rows that changed or disappeared remain untouched.")

    if not args.apply:
        print("\nDRY RUN ONLY — no database changes were made.")
        return 0

    workers = cannlytics_workers()
    if workers:
        raise SystemExit("Cannlytics started while recovery was scanning. Refusing to apply.")

    backup_dir = Path(args.backup_dir).expanduser().resolve()
    backup = create_backup(db_path, backup_dir)
    print(f"\nBackup created: {backup}")

    db = sqlite3.connect(db_path, timeout=120)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    updated = skipped_changed = 0
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute(
            "CREATE INDEX IF NOT EXISTS cannabis_coa_sources_batch_idx "
            "ON cannabis_coa_sources(batch_id)"
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS cannlytics_source_records_batch_idx "
            "ON cannlytics_source_records(batch_id)"
        )
        for external_key, raw_payload in recovered.items():
            record = source_records[external_key]
            current = db.execute(
                "SELECT row_hash,batch_id FROM cannlytics_source_records WHERE external_key=?",
                (external_key,),
            ).fetchone()
            if (
                not current
                or str(current["row_hash"] or "") != record["row_hash"]
                or str(current["batch_id"] or "") != record["batch_id"]
            ):
                skipped_changed += len(record["source_ids"])
                continue
            for source_id in record["source_ids"]:
                cursor = db.execute(
                    """
                    UPDATE cannabis_coa_sources
                    SET raw_payload_json=?
                    WHERE id=? AND source_name='Cannlytics' AND external_id=?
                      AND batch_id=? AND COALESCE(TRIM(raw_payload_json),'')=''
                    """,
                    (raw_payload, source_id, external_key, record["batch_id"]),
                )
                updated += cursor.rowcount

        fk_issues = db.execute("PRAGMA foreign_key_check").fetchall()
        if fk_issues:
            raise RuntimeError(
                f"Foreign-key check failed with {len(fk_issues)} issue(s): {fk_issues[:10]}"
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print("\nRaw Cannlytics provenance recovery saved.")
    print(f"COA-source rows updated: {updated:,}")
    print(f"Rows skipped because their source mapping changed during the scan: {skipped_changed:,}")
    print("Canonical product and lab data remain unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
