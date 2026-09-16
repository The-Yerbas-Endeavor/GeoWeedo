#!/usr/bin/env python3
"""Owner-enrichment entrypoint with recovered-provenance identity filtering.

This layers the existing atomic/performance wrapper with the same conservative
producer sanitation used by the Cannlytics importer. Recovered raw payloads must
remain raw, but role-only and location-only values must not become strong owner
evidence merely because they are visible again during enrichment.
"""

import importlib.util
from pathlib import Path
import re
import sys

SAFE_PATH = Path(__file__).with_name("enrich-cannlytics-owners-safe.py")

GENERIC_OWNER_LABELS = {
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
LOCATION_ONLY_OWNER = re.compile(
    r"^[^,]+,\s*[A-Z]{2}\s*,\s*\d{5}(?:-\d{4})?\s*,\s*(?:US|USA|UNITED STATES)$",
    re.IGNORECASE,
)

spec = importlib.util.spec_from_file_location(
    "geoweedo_cannlytics_owner_enrichment_safe",
    SAFE_PATH,
)
if spec is None or spec.loader is None:
    raise SystemExit(f"Unable to load owner-enrichment wrapper at {SAFE_PATH}")

safe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safe)

original_plausible_owner = safe.module.plausible_owner


def provenance_safe_owner(value):
    parsed = original_plausible_owner(value)
    if not parsed:
        return None
    display, normalized = parsed
    if normalized in GENERIC_OWNER_LABELS:
        return None
    if LOCATION_ONLY_OWNER.fullmatch(display):
        return None
    return parsed


safe.module.plausible_owner = provenance_safe_owner

if __name__ == "__main__":
    sys.exit(safe.module.main())
