#!/usr/bin/env python3
"""Atomic wrapper for the Cannlytics owner-enrichment pipeline.

The core resolver intentionally lives in enrich-cannlytics-owners.py. This
wrapper replaces its schema helper with statement-by-statement DDL so calling
it inside the resolver's BEGIN IMMEDIATE transaction never invokes
sqlite3.Connection.executescript(), which can implicitly end a transaction.
"""

import importlib.util
import sys
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
]


def ensure_schema_atomic(db):
    for statement in SCHEMA_STATEMENTS:
        db.execute(statement)


module.ensure_schema = ensure_schema_atomic

if __name__ == "__main__":
    sys.exit(module.main())
