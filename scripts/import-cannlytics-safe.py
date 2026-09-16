#!/usr/bin/env python3
"""Run the Cannlytics importer with production-safe cleanup and provenance capture.

Cannlytics source rows can occasionally expose a role/category such as
"Processing" or a location-only value where GeoWeedo expects a licensed
business name. This wrapper filters only strong non-business identities and
leaves real business names (for example, "MFNY Processor LLC") unchanged.

The original importer currently contains a one-character database filename typo
(`geoweodo.sqlite`). GeoWeedo's production database is `geoweedo.sqlite`. Rather
than duplicate or rewrite the large importer, this wrapper redirects only that
exact filename while the importer runs.

The historical importer also inserted NULL into cannabis_coa_sources.raw_payload_json.
This wrapper captures the normalized upstream row at import time and supplies it
to that one insert. Existing rows are recovered separately by
backfill-cannlytics-raw-provenance.py.
"""

from collections import Counter
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re

IMPORTER_PATH = Path(__file__).with_name("import-cannlytics-public.py")
PROVENANCE_VERSION = 1

GENERIC_PRODUCER_LABELS = {
    "processing",
    "processor",
    "cultivation",
    "cultivator",
    "manufacturing",
    "manufacturer",
    "production",
    "producer",
    "distribution",
    "distributor",
    "retail",
    "retailer",
    "licensee",
}

LOCATION_ONLY_PRODUCER = re.compile(
    r"^[^,]+,\s*[A-Z]{2}\s*,\s*\d{5}(?:-\d{4})?\s*,\s*(?:US|USA|UNITED STATES)$",
    re.IGNORECASE,
)

spec = importlib.util.spec_from_file_location("geoweedo_cannlytics_importer", IMPORTER_PATH)
if spec is None or spec.loader is None:
    raise SystemExit(f"Unable to load Cannlytics importer at {IMPORTER_PATH}")

importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)

original_pick = importer.pick
original_path_join = importer.Path.__truediv__
original_normalized_row = importer.normalized_row
original_connect = importer.sqlite3.connect

sanitized = Counter()
current_raw_payload = None
captured_provenance_rows = 0


def safe_pick(row, *keys):
    value = original_pick(row, *keys)
    if keys and keys[0] == "producer" and value:
        normalized = importer.norm(value)
        if normalized in GENERIC_PRODUCER_LABELS or LOCATION_ONLY_PRODUCER.fullmatch(value):
            sanitized[value] += 1
            return None
    return value


def safe_path_join(path, child):
    if child == "geoweodo.sqlite":
        child = "geoweedo.sqlite"
    return original_path_join(path, child)


def capture_normalized_row(raw):
    global current_raw_payload
    row = original_normalized_row(raw)
    current_raw_payload = json.dumps(
        {
            "_geoweedo_provenance": {
                "kind": "import_capture",
                "version": PROVENANCE_VERSION,
                "dataset": importer.DATASET_PAGE,
                "captured_at": datetime.now(timezone.utc).isoformat(),
            },
            "row": row,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return row


class ProvenanceConnection(importer.sqlite3.Connection):
    def execute(self, sql, parameters=(), /):
        global captured_provenance_rows
        compact = " ".join(str(sql).split())
        if (
            current_raw_payload
            and "INSERT INTO cannabis_coa_sources(" in compact
            and "raw_payload_json" in compact
            and "NULL,'cannlytics-v1'" in compact
        ):
            compact = compact.replace(
                "NULL,'cannlytics-v1'",
                "?,'cannlytics-v1'",
                1,
            )
            values = list(parameters)
            # Original placeholders are id, batch_id, source_url, external_id,
            # fetched_at, created_at. raw_payload_json follows external_id.
            values.insert(4, current_raw_payload)
            captured_provenance_rows += 1
            return super().execute(compact, tuple(values))
        return super().execute(sql, parameters)


def provenance_connect(*args, **kwargs):
    if "factory" not in kwargs:
        kwargs["factory"] = ProvenanceConnection
    return original_connect(*args, **kwargs)


importer.pick = safe_pick
importer.Path.__truediv__ = safe_path_join
importer.normalized_row = capture_normalized_row
importer.sqlite3.connect = provenance_connect

try:
    importer.main()
finally:
    importer.Path.__truediv__ = original_path_join
    importer.normalized_row = original_normalized_row
    importer.sqlite3.connect = original_connect

if sanitized:
    total = sum(sanitized.values())
    details = ", ".join(f"{label}={count}" for label, count in sanitized.most_common())
    print(f"  sanitized generic producer identities: {total} ({details})")
else:
    print("  sanitized generic producer identities: 0")

print(f"  raw provenance rows captured at import time: {captured_provenance_rows}")
