#!/usr/bin/env python3
"""Run the Cannlytics importer with production-safe cleanup and path fixes.

Cannlytics source rows can occasionally expose a role/category such as
"Processing" where GeoWeedo expects a licensed business name. This wrapper
filters only exact generic labels and leaves real business names (for example,
"MFNY Processor LLC") unchanged.

The original importer currently contains a one-character database filename typo
(`geoweodo.sqlite`). GeoWeedo's production database is `geoweedo.sqlite`. Rather
than duplicate or rewrite the large importer, this wrapper redirects only that
exact filename while the importer runs.
"""
from collections import Counter
import importlib.util
from pathlib import Path

IMPORTER_PATH = Path(__file__).with_name("import-cannlytics-public.py")

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

spec = importlib.util.spec_from_file_location("geoweedo_cannlytics_importer", IMPORTER_PATH)
if spec is None or spec.loader is None:
    raise SystemExit(f"Unable to load Cannlytics importer at {IMPORTER_PATH}")

importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)
original_pick = importer.pick
original_path_join = importer.Path.__truediv__
sanitized = Counter()


def safe_pick(row, *keys):
    value = original_pick(row, *keys)
    # The main importer requests the business identity with this producer field
    # family. Do not alter producer license fields or any unrelated values.
    if keys and keys[0] == "producer" and value:
        normalized = importer.norm(value)
        if normalized in GENERIC_PRODUCER_LABELS:
            sanitized[value] += 1
            return None
    return value


def safe_path_join(path, child):
    # Redirect only the importer's known typo to GeoWeedo's real production DB.
    if child == "geoweodo.sqlite":
        child = "geoweedo.sqlite"
    return original_path_join(path, child)


importer.pick = safe_pick
importer.Path.__truediv__ = safe_path_join

try:
    importer.main()
finally:
    importer.Path.__truediv__ = original_path_join

if sanitized:
    total = sum(sanitized.values())
    details = ", ".join(f"{label}={count}" for label, count in sanitized.most_common())
    print(f"  sanitized generic producer identities: {total} ({details})")
else:
    print("  sanitized generic producer identities: 0")
