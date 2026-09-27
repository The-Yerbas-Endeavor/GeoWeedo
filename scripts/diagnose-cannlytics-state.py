#!/usr/bin/env python3
"""Read-only Cannlytics state parser diagnostic.

Samples raw upstream rows with the same normalization/eligibility rules used by
GeoWeedo's production importer. It never opens or mutates the GeoWeedo database.
"""
import argparse
import importlib.util
import json
from pathlib import Path

ROOT = Path.cwd()
LEGACY_SCRIPT = ROOT / "scripts" / "import-cannlytics-public.py"


def load_legacy():
    spec = importlib.util.spec_from_file_location("geoweedo_cannlytics_diag", LEGACY_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {LEGACY_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description="Diagnose Cannlytics parser eligibility for one state.")
    parser.add_argument("--state", required=True)
    parser.add_argument("--sample", type=int, default=5000)
    args = parser.parse_args()

    legacy = load_legacy()
    state = args.state.lower()
    if state not in legacy.STATE_FILES:
        raise SystemExit(f"Unknown Cannlytics state: {state}")

    sample_limit = max(100, min(20000, args.sample))
    extension, configured_upstream = legacy.STATE_FILES[state]
    cache_dir = ROOT / "data" / "source-cache" / "cannlytics"
    source_file, cached = legacy.download_dataset(state, extension, cache_dir)

    result = {
        "state": state,
        "configuredUpstreamRecords": configured_upstream,
        "sourceFile": source_file.name,
        "usedCache": bool(cached),
        "sampleLimit": sample_limit,
        "sampledRows": 0,
        "rowsWithProductName": 0,
        "rowsWithIdentifier": 0,
        "rowsWithAnalytes": 0,
        "eligibleRows": 0,
        "missingProductName": 0,
        "missingIdentifier": 0,
        "missingAnalytes": 0,
        "duplicateEligibleKeys": 0,
        "headers": [],
        "examples": [],
    }

    seen = set()
    for raw in legacy.iter_rows(source_file):
        if result["sampledRows"] >= sample_limit:
            break
        result["sampledRows"] += 1
        if not result["headers"]:
            result["headers"] = [str(key) for key in raw.keys()][:80]

        row = legacy.normalized_row(raw)
        product_name = legacy.source_product_name(row, state)
        sample_id = legacy.pick(row, "sample_id", "lab_id")
        batch_number = legacy.pick(row, "batch_number", "batch", "lot_number")
        record_id = legacy.pick(row, "id", "sample_hash", "results_hash", "source_id")
        analytes = legacy.analytes_from_row(row)

        if product_name:
            result["rowsWithProductName"] += 1
        else:
            result["missingProductName"] += 1

        identifier = record_id or sample_id or batch_number
        if identifier:
            result["rowsWithIdentifier"] += 1
        else:
            result["missingIdentifier"] += 1

        if analytes:
            result["rowsWithAnalytes"] += 1
        else:
            result["missingAnalytes"] += 1

        if not product_name or not identifier or not analytes:
            continue

        producer = legacy.pick(row, "producer", "producer_name", "cultivator", "manufacturer", "licensee")
        date_tested = legacy.iso_date(legacy.pick(row, "date_tested", "tested_at", "test_date"))
        fallback = "|".join([state, product_name, producer or "", batch_number or "", sample_id or "", date_tested or ""])
        source_record_id = record_id or legacy.stable_hash("", fallback, 32)
        key = f"{state}:{source_record_id}"
        if key in seen:
            result["duplicateEligibleKeys"] += 1
            continue
        seen.add(key)
        result["eligibleRows"] += 1

        if len(result["examples"]) < 5:
            result["examples"].append({
                "productName": product_name,
                "identifier": str(identifier),
                "analytes": len(analytes),
                "producer": producer,
            })

    sampled = result["sampledRows"]
    eligible = result["eligibleRows"]
    result["eligiblePercent"] = round((eligible / sampled) * 100, 1) if sampled else 0
    if eligible > 0:
        result["diagnosis"] = "parser-healthy"
    elif result["rowsWithProductName"] == 0 and state == "or":
        result["diagnosis"] = "source-missing-product-identity"
    elif result["rowsWithProductName"] == 0:
        result["diagnosis"] = "product-identity-unresolved"
    else:
        result["diagnosis"] = "no-eligible-rows"
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
