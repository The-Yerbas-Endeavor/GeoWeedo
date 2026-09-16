#!/usr/bin/env python3
"""Atomic/performance wrapper for the Cannlytics owner-enrichment pipeline.

The core resolver intentionally lives in enrich-cannlytics-owners.py. This
wrapper keeps its write path atomic and replaces the original multi-join loader
with bounded one-pass scans so production dry-runs do not repeatedly rescan
unindexed source tables.
"""

import importlib.util
import json
import sys
import time
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("enrich-cannlytics-owners.py")
spec = importlib.util.spec_from_file_location("geoweedo_cannlytics_owner_enrichment", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS cannabis_product_owner_evidence (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      batch_id TEXT,
      state_code TEXT,
      owner_name TEXT NOT NULL,
      normalized_owner_name TEXT NOT NULL,
      owner_type TEXT NOT NULL,
      evidence_field TEXT NOT NULL,
      evidence_source TEXT NOT NULL,
      confidence REAL NOT NULL,
      source_external_id TEXT,
      resolver_version INTEGER NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE CASCADE,
      FOREIGN KEY(batch_id) REFERENCES cannabis_batches(id) ON DELETE CASCADE
    )
    """,
    """CREATE INDEX IF NOT EXISTS idx_product_owner_evidence_product
       ON cannabis_product_owner_evidence(product_id)""",
    """CREATE INDEX IF NOT EXISTS idx_product_owner_evidence_owner
       ON cannabis_product_owner_evidence(normalized_owner_name,owner_type)""",
    """
    CREATE TABLE IF NOT EXISTS cannabis_product_owner_resolution (
      product_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      owner_name TEXT,
      normalized_owner_name TEXT,
      owner_type TEXT,
      confidence REAL,
      evidence_count INTEGER NOT NULL DEFAULT 0,
      distinct_batch_count INTEGER NOT NULL DEFAULT 0,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      resolver_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE CASCADE
    )
    """,
    """CREATE INDEX IF NOT EXISTS idx_product_owner_resolution_status
       ON cannabis_product_owner_resolution(status,confidence)""",
    # These joins are used heavily by Cannlytics reconciliation/enrichment.
    # Existing production databases may predate them, so create them during the
    # backed-up --apply transaction. The dry-run below does not depend on them.
    """CREATE INDEX IF NOT EXISTS idx_cannabis_batches_product_source
       ON cannabis_batches(product_id,source_name)""",
    """CREATE INDEX IF NOT EXISTS idx_cannabis_coa_sources_batch_source
       ON cannabis_coa_sources(batch_id,source_name)""",
    """CREATE INDEX IF NOT EXISTS idx_cannlytics_source_records_batch
       ON cannlytics_source_records(batch_id)""",
]


def ensure_schema_atomic(db):
    for statement in SCHEMA_STATEMENTS:
        db.execute(statement)


def _progress(stage, count, started, detail=""):
    elapsed = time.monotonic() - started
    suffix = f" | {detail}" if detail else ""
    print(
        f"[owner enrichment] {stage}: {count:,} row(s) | elapsed {elapsed:,.1f}s{suffix}",
        flush=True,
    )


def load_contexts_linear(db):
    """Match v1 missing-owner semantics without N x full-table join rescans.

    The original query joined missing products to cannabis_coa_sources and
    cannlytics_source_records by batch_id. Older databases do not necessarily
    have batch_id indexes on those source tables, which can make SQLite rescan
    the same cached pages millions of times. This loader scans each source table
    at most once and joins the small target set in Python.
    """
    started = time.monotonic()
    candidates = {}
    batch_rows = 0

    # Pass 1: identify exactly the cp-cann products with a blank brand and no
    # Cannlytics batch carrying producer_name. Keep the batch metadata needed by
    # later passes so no second cannabis_batches scan is required.
    batch_sql = """
      SELECT
        p.id AS product_id,p.product_name,p.product_type,
        b.id AS batch_id,b.lab_name,b.producer_name
      FROM cannabis_batches b
      JOIN cannabis_products p ON p.id=b.product_id
      WHERE b.source_name='Cannlytics'
        AND p.id LIKE 'cp-cann-%'
        AND COALESCE(TRIM(p.brand_name),'')=''
    """
    for row in db.execute(batch_sql):
        batch_rows += 1
        product_id = str(row["product_id"])
        item = candidates.setdefault(product_id, {
            "product_id": product_id,
            "product_name": row["product_name"],
            "product_type": row["product_type"],
            "batch_ids": set(),
            "batch_labs": {},
            "states": set(),
            "payload_rows": 0,
            "payload_errors": 0,
            "evidence": [],
            "has_producer": False,
        })
        batch_id = str(row["batch_id"])
        item["batch_ids"].add(batch_id)
        item["batch_labs"][batch_id] = row["lab_name"]
        if str(row["producer_name"] or "").strip():
            item["has_producer"] = True

        if batch_rows % 50000 == 0:
            _progress(
                "Cannlytics batch scan",
                batch_rows,
                started,
                f"{len(candidates):,} blank-brand product candidate(s)",
            )

    contexts = {}
    target_batches = {}
    for product_id, item in candidates.items():
        if item["has_producer"]:
            continue
        item.pop("has_producer", None)
        item["batch_count"] = len(item["batch_ids"])
        contexts[product_id] = item
        for batch_id in item["batch_ids"]:
            target_batches[batch_id] = (
                product_id,
                item["batch_labs"].get(batch_id),
            )

    _progress(
        "Missing-owner target set",
        batch_rows,
        started,
        f"{len(contexts):,} product(s), {len(target_batches):,} batch(es)",
    )

    # Pass 2: scan source-record metadata once and retain state only for target
    # batches. A batch normally has one state; sets make duplicate source rows
    # harmless and preserve any genuine multi-state anomaly for review.
    batch_states = {}
    source_record_rows = 0
    matched_source_records = 0
    for row in db.execute(
        "SELECT batch_id,state_code FROM cannlytics_source_records WHERE batch_id IS NOT NULL"
    ):
        source_record_rows += 1
        batch_id = str(row["batch_id"])
        target = target_batches.get(batch_id)
        if target:
            matched_source_records += 1
            state = str(row["state_code"] or "").strip().upper()
            if state:
                batch_states.setdefault(batch_id, set()).add(state)
                contexts[target[0]]["states"].add(state)

        if source_record_rows % 100000 == 0:
            _progress(
                "Cannlytics source-record scan",
                source_record_rows,
                started,
                f"{matched_source_records:,} target row(s)",
            )

    _progress(
        "Cannlytics source-record scan complete",
        source_record_rows,
        started,
        f"{matched_source_records:,} target row(s)",
    )

    # Pass 3: scan Cannlytics COA payloads once. The existing
    # (source_name, external_id) index can constrain this by source_name, while
    # target_batches performs the batch_id join in memory.
    coa_rows = 0
    target_payload_rows = 0
    evidence_rows = 0
    for row in db.execute(
        """
        SELECT batch_id,external_id,raw_payload_json
        FROM cannabis_coa_sources
        WHERE source_name='Cannlytics' AND batch_id IS NOT NULL
        """
    ):
        coa_rows += 1
        batch_id = str(row["batch_id"])
        target = target_batches.get(batch_id)
        if target:
            product_id, lab_name = target
            item = contexts[product_id]
            raw_payload = row["raw_payload_json"]
            if raw_payload:
                target_payload_rows += 1
                item["payload_rows"] += 1
                states = sorted(batch_states.get(batch_id, ()))
                state_code = states[0] if states else None
                extracted = module.extract_payload_evidence(
                    raw_payload,
                    product_id=product_id,
                    product_name=item["product_name"],
                    batch_id=batch_id,
                    state_code=state_code,
                    external_id=row["external_id"],
                    lab_name=lab_name,
                )
                item["evidence"].extend(extracted)
                evidence_rows += len(extracted)

                # Only do a second JSON parse when extract_payload_evidence()
                # found nothing; that is the only case where malformed payloads
                # still need to be distinguished from valid no-owner payloads.
                if not extracted:
                    try:
                        json.loads(raw_payload)
                    except Exception:
                        item["payload_errors"] += 1

        if coa_rows % 25000 == 0:
            _progress(
                "Cannlytics COA-source scan",
                coa_rows,
                started,
                f"{target_payload_rows:,} target payload(s), {evidence_rows:,} evidence row(s)",
            )

    _progress(
        "Cannlytics COA-source scan complete",
        coa_rows,
        started,
        f"{target_payload_rows:,} target payload(s), {evidence_rows:,} evidence row(s)",
    )

    # Keep original v1 behavior: duplicate evidence originating from duplicate
    # source metadata is collapsed by its stable evidence id.
    for item in contexts.values():
        unique = {}
        for row in item["evidence"]:
            unique[row["id"]] = row
        item["evidence"] = list(unique.values())
        item.pop("batch_labs", None)

    _progress(
        "Owner context build complete",
        len(contexts),
        started,
        f"{sum(len(item['evidence']) for item in contexts.values()):,} unique evidence row(s)",
    )
    return contexts


module.ensure_schema = ensure_schema_atomic
module.load_contexts = load_contexts_linear

if __name__ == "__main__":
    sys.exit(module.main())
