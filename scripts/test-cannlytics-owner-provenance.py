#!/usr/bin/env python3
"""Regression tests for Cannlytics recovered-provenance owner filtering."""

import importlib.util
import json
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("enrich-cannlytics-owners-provenance.py")
spec = importlib.util.spec_from_file_location("geoweedo_owner_provenance_test_target", MODULE_PATH)
if spec is None or spec.loader is None:
    raise SystemExit(f"Unable to load {MODULE_PATH}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def evidence(row):
    payload = json.dumps({"row": row})
    return module.provenance_safe_extract(
        payload,
        product_id="cp-cann-test",
        product_name="Test Product",
        batch_id="cb-test",
        state_code="FL",
        external_id="fl:test",
        lab_name="Test Lab",
    )


def one(rows, field):
    matches = [row for row in rows if row["evidence_field"] == field]
    assert len(matches) == 1, (field, rows)
    return matches[0]


lake_wales = one(
    evidence({"processor": "Lake Wales", "processing_facility": "Lake Wales"}),
    "processor",
)
assert lake_wales["confidence"] == 0.82, lake_wales

ruskin = one(
    evidence({"processor": "Ruskin", "producer_city": "Ruskin"}),
    "processor",
)
assert ruskin["confidence"] == 0.82, ruskin

sweetwater = one(
    evidence({"processor": "Sweetwater Processing", "processing_facility": "Sweetwater Processing"}),
    "processor",
)
assert sweetwater["confidence"] == 0.92, sweetwater

licensee = one(
    evidence({"licensee": "GROW OP FARMS LLC", "producer_city": "Spokane"}),
    "licensee",
)
assert licensee["confidence"] == 0.82, licensee

role_only = evidence({"processor": "Processing"})
assert not role_only, role_only

full_location = evidence({"processor": "Apollo Beach, FL, 33572, US"})
assert not full_location, full_location

print("Cannlytics owner provenance safeguards: OK")
