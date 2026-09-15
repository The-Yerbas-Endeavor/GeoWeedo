#!/usr/bin/env python3
"""Checkpointed wrapper around the Cannlytics importer.

The existing importer remains the single implementation of row normalization and
upsert behavior. This wrapper gives large state datasets a durable raw-row cursor,
runs bounded chunks, redirects the historical geoweodo.sqlite typo in-process to
the actual GeoWeedo runtime database, and converts XLSX sources to a persistent
CSV resume cache so later checkpoints do not repeatedly parse Excel XML.
"""
import argparse
import csv
import importlib.util
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd()
LEGACY_SCRIPT = ROOT / "scripts" / "import-cannlytics-public.py"
CORRECT_DB = ROOT / "data" / "runtime" / "geoweedo.sqlite"
CHECKPOINT_EXIT = 75
DEFAULT_CHUNK_SIZE = 25000


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_legacy():
    spec = importlib.util.spec_from_file_location("geoweedo_cannlytics_legacy", LEGACY_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {LEGACY_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def redirect_legacy_path(legacy):
    """Make only the legacy geoweodo.sqlite path resolve to geoweedo.sqlite."""
    concrete_path = type(Path())

    class GeoWeedoPath(concrete_path):
        @classmethod
        def cwd(cls):
            return cls(str(ROOT))

        def __truediv__(self, key):
            candidate = super().__truediv__(key)
            if self.name == "runtime" and str(key) == "geoweodo.sqlite":
                return type(self)(str(CORRECT_DB))
            return candidate

    legacy.Path = GeoWeedoPath


def ensure_progress_schema(db, legacy, state, upstream):
    legacy.ensure_schema(db)
    columns = {row[1] for row in db.execute("PRAGMA table_info(cannlytics_state_sync)").fetchall()}
    additions = {
        "next_row_offset": "INTEGER NOT NULL DEFAULT 0",
        "processed_records": "INTEGER NOT NULL DEFAULT 0",
        "last_progress_at": "TEXT",
    }
    for name, definition in additions.items():
        if name not in columns:
            db.execute(f"ALTER TABLE cannlytics_state_sync ADD COLUMN {name} {definition}")
    timestamp = now_iso()
    db.execute("""
      INSERT INTO cannlytics_state_sync(state_code,upstream_records,updated_at)
      VALUES(?,?,?)
      ON CONFLICT(state_code) DO UPDATE SET upstream_records=excluded.upstream_records
    """, (state, upstream, timestamp))
    db.commit()


def prepare_resumable_source(legacy, state, source_file, cache_dir):
    """Convert XLSX once to CSV so later resume chunks avoid reparsing XML."""
    if source_file.suffix.lower() != ".xlsx":
        return source_file

    target = cache_dir / f"{state}-results-latest.resumable.csv"
    meta_path = cache_dir / f"{state}-results-latest.resumable.meta.json"
    source_stat = source_file.stat()
    fingerprint = {
        "source_size": source_stat.st_size,
        "source_mtime_ns": source_stat.st_mtime_ns,
    }

    if target.exists() and meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
            if all(meta.get(key) == value for key, value in fingerprint.items()):
                print(f"Using resumable CSV cache {target.name} ({target.stat().st_size / (1024*1024):.1f} MiB)")
                return target
        except Exception:
            pass

    temp = target.with_suffix(target.suffix + ".part")
    print(f"Preparing one-time resumable CSV cache for {state.upper()} from {source_file.name}...")
    writer = None
    rows_written = 0
    with temp.open("w", encoding="utf-8", newline="") as handle:
        for raw in legacy.iter_rows(source_file):
            if writer is None:
                fields = list(raw.keys())
                writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
                writer.writeheader()
            writer.writerow(raw)
            rows_written += 1
    if writer is None:
        raise RuntimeError(f"Cannlytics {state.upper()} XLSX did not contain data rows")

    temp.replace(target)
    meta_path.write_text(json.dumps({
        **fingerprint,
        "rows": rows_written,
        "created_at": now_iso(),
        "source": str(source_file),
    }, indent=2))
    print(f"Prepared resumable CSV cache with {rows_written:,} rows: {target.name}")
    return target


def external_key_for_raw(legacy, state, raw):
    row = legacy.normalized_row(raw)
    product_name = legacy.pick(row, "product_name", "strain_name", "product")
    if not product_name:
        return None
    sample_id = legacy.pick(row, "sample_id", "lab_id")
    batch_number = legacy.pick(row, "batch_number", "batch", "lot_number")
    record_id = legacy.pick(row, "id", "sample_hash", "results_hash", "source_id")
    analytes = legacy.analytes_from_row(row)
    if not analytes or not (record_id or sample_id or batch_number):
        return None
    date_tested = legacy.iso_date(legacy.pick(row, "date_tested", "tested_at", "test_date"))
    producer = legacy.pick(row, "producer", "producer_name", "cultivator", "manufacturer", "licensee")
    fallback = "|".join([state, product_name, producer or "", batch_number or "", sample_id or "", date_tested or ""])
    source_record_id = record_id or legacy.stable_hash("", fallback, 32)
    return f"{state}:{source_record_id}"


def bootstrap_offset(db, legacy, state, source_file):
    existing = {row[0] for row in db.execute(
        "SELECT external_key FROM cannlytics_source_records WHERE state_code=?", (state,)
    ).fetchall()}
    if not existing:
        return 0
    safe_offset = 0
    for index, raw in enumerate(legacy.iter_rows(source_file)):
        key = external_key_for_raw(legacy, state, raw)
        if key is not None and key not in existing:
            break
        safe_offset = index + 1
    print(f"Recovered safe {state.upper()} checkpoint at raw row {safe_offset:,} from {len(existing):,} existing records")
    return safe_offset


def main():
    parser = argparse.ArgumentParser(description="Run one resumable Cannlytics import chunk.")
    parser.add_argument("--state", required=True)
    parser.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE)
    args = parser.parse_args()
    state = args.state.lower()
    chunk_size = max(1000, min(100000, args.chunk_size))

    if not CORRECT_DB.exists():
        raise SystemExit(f"GeoWeedo database not found at {CORRECT_DB}")

    legacy = load_legacy()
    redirect_legacy_path(legacy)
    if state not in legacy.STATE_FILES:
        raise SystemExit(f"Unknown Cannlytics state: {state}")
    extension, upstream_records = legacy.STATE_FILES[state]

    cache_dir = ROOT / "data" / "source-cache" / "cannlytics"
    original_download_dataset = legacy.download_dataset
    source_file, _cached = original_download_dataset(state, extension, cache_dir)
    source_file = prepare_resumable_source(legacy, state, source_file, cache_dir)

    # legacy.main() owns normalization/upsert behavior. Make it reuse the source
    # already prepared above instead of performing another network/cache lookup.
    def reuse_prepared_source(_state, _extension, _cache_dir):
        return source_file, True

    legacy.download_dataset = reuse_prepared_source

    db = sqlite3.connect(CORRECT_DB, timeout=60)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")
    ensure_progress_schema(db, legacy, state, upstream_records)

    sync = db.execute("SELECT * FROM cannlytics_state_sync WHERE state_code=?", (state,)).fetchone()
    offset = int(sync["next_row_offset"] or 0)
    previous_completed = sync["last_completed_at"]

    if offset <= 0 and previous_completed is None:
        existing_count = db.execute(
            "SELECT COUNT(*) FROM cannlytics_source_records WHERE state_code=?", (state,)
        ).fetchone()[0]
        if existing_count:
            offset = bootstrap_offset(db, legacy, state, source_file)
            timestamp = now_iso()
            db.execute("""
              UPDATE cannlytics_state_sync
              SET next_row_offset=?,processed_records=?,last_progress_at=?,updated_at=?
              WHERE state_code=?
            """, (offset, offset, timestamp, timestamp, state))
            db.commit()
    db.close()

    tracker = {"next_offset": offset, "yielded": 0, "exhausted": False}
    original_iter_rows = legacy.iter_rows

    def chunked_rows(path):
        raw_index = 0
        for raw in original_iter_rows(path):
            if raw_index < offset:
                raw_index += 1
                continue
            if tracker["yielded"] >= chunk_size:
                tracker["next_offset"] = raw_index
                return
            yield raw
            raw_index += 1
            tracker["yielded"] += 1
            tracker["next_offset"] = raw_index
        tracker["exhausted"] = True
        tracker["next_offset"] = raw_index

    legacy.iter_rows = chunked_rows
    old_argv = sys.argv[:]
    sys.argv = [str(LEGACY_SCRIPT), "--state", state]
    try:
        legacy.main()
    except Exception:
        db = sqlite3.connect(CORRECT_DB, timeout=60)
        timestamp = now_iso()
        db.execute("""
          UPDATE cannlytics_state_sync
          SET last_completed_at=?,last_progress_at=?,updated_at=?
          WHERE state_code=?
        """, (previous_completed, timestamp, timestamp, state))
        db.commit()
        db.close()
        raise
    finally:
        sys.argv = old_argv

    db = sqlite3.connect(CORRECT_DB, timeout=60)
    timestamp = now_iso()
    imported_records = db.execute(
        "SELECT COUNT(*) FROM cannlytics_source_records WHERE state_code=?", (state,)
    ).fetchone()[0]
    if tracker["exhausted"]:
        db.execute("""
          UPDATE cannlytics_state_sync
          SET imported_records=?,next_row_offset=0,processed_records=?,last_progress_at=?,last_error=NULL,updated_at=?
          WHERE state_code=?
        """, (imported_records, tracker["next_offset"], timestamp, timestamp, state))
        db.commit()
        db.close()
        print(f"Completed {state.upper()} at raw row {tracker['next_offset']:,}; {imported_records:,} source records tracked")
        return 0

    db.execute("""
      UPDATE cannlytics_state_sync
      SET imported_records=?,next_row_offset=?,processed_records=?,last_progress_at=?,last_completed_at=?,last_error=NULL,updated_at=?
      WHERE state_code=?
    """, (imported_records, tracker["next_offset"], tracker["next_offset"], timestamp, previous_completed, timestamp, state))
    db.commit()
    db.close()
    print(f"Checkpoint {state.upper()}: raw row {tracker['next_offset']:,}; {imported_records:,} source records tracked")
    return CHECKPOINT_EXIT


if __name__ == "__main__":
    sys.exit(main())
