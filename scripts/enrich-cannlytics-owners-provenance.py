#!/usr/bin/env python3
"""Owner-enrichment entrypoint with recovered-provenance identity filtering.

This layers the existing atomic/performance wrapper with conservative identity
sanitation. Recovered raw payloads must remain raw, but role-only values,
location-only values, and bare facility labels must not become strong owner
evidence merely because they are visible again during enrichment.
"""

from collections import Counter
import importlib.util
import json
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

# Bare values in these fields are commonly facility/location labels in parsed
# Florida COAs (for example, "Processing Facility: Lake Wales"). They remain
# useful evidence, but should be review-only unless the value itself carries a
# business-name cue or independent stronger evidence exists.
BARE_FACILITY_FIELDS = {
    "processor",
    "manufacturer",
    "manufacturing_facility",
    "processing_facility",
    "cultivation_facility",
    "source_facility",
}
LOCATION_FIELD_MARKERS = (
    "city",
    "street",
    "address",
    "location",
    "zipcode",
    "zip_code",
    "postal_code",
)
BUSINESS_CUES = {
    "llc", "inc", "incorporated", "corp", "corporation", "company", "co",
    "holdings", "group", "enterprises", "brands", "brand", "cannabis",
    "farms", "farm", "gardens", "garden", "nursery", "labs", "laboratories",
    "extracts", "processing", "processor", "cultivation", "cultivator",
    "manufacturing", "manufacturer", "dispensary", "wellness",
}
REVIEW_CONFIDENCE = 0.82

spec = importlib.util.spec_from_file_location(
    "geoweedo_cannlytics_owner_enrichment_safe",
    SAFE_PATH,
)
if spec is None or spec.loader is None:
    raise SystemExit(f"Unable to load owner-enrichment wrapper at {SAFE_PATH}")

safe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safe)

original_plausible_owner = safe.module.plausible_owner
original_extract_payload_evidence = safe.module.extract_payload_evidence
location_demotions = Counter()


def has_business_cue(normalized):
    tokens = set(str(normalized or "").split())
    return bool(tokens & BUSINESS_CUES)


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


def raw_row_from_payload(raw_payload):
    try:
        payload = json.loads(raw_payload)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    row = payload.get("row")
    return row if isinstance(row, dict) else payload


def location_like_values(raw_payload):
    row = raw_row_from_payload(raw_payload)
    if not row:
        return set()

    values = set()
    for path, value in safe.module.flatten_json(row):
        leaf = path[-1] if path else ""
        is_location_field = any(marker in leaf for marker in LOCATION_FIELD_MARKERS)
        is_bare_facility_field = leaf in BARE_FACILITY_FIELDS
        if not is_location_field and not is_bare_facility_field:
            continue
        parsed = original_plausible_owner(value)
        if not parsed:
            continue
        _display, normalized = parsed
        # Named businesses such as "Homestead Processing" are not treated as
        # locations merely because they appear in a facility field.
        if not has_business_cue(normalized):
            values.add(normalized)
    return values


def provenance_safe_extract(raw_payload, **kwargs):
    rows = original_extract_payload_evidence(raw_payload, **kwargs)
    location_values = location_like_values(raw_payload)

    for row in rows:
        if float(row.get("confidence") or 0) < 0.90:
            continue
        normalized = str(row.get("normalized_owner_name") or "")
        field = str(row.get("evidence_field") or "")
        location_match = normalized in location_values
        bare_facility = field in BARE_FACILITY_FIELDS and not has_business_cue(normalized)
        if not location_match and not bare_facility:
            continue

        old_confidence = float(row["confidence"])
        row["confidence"] = min(old_confidence, REVIEW_CONFIDENCE)
        location_demotions[(str(row.get("owner_name") or normalized), field)] += 1

    return rows


safe.module.plausible_owner = provenance_safe_owner
safe.module.extract_payload_evidence = provenance_safe_extract

if __name__ == "__main__":
    result = safe.module.main()
    if location_demotions:
        print("\nLocation/facility evidence demoted to review-only:")
        print(f"  Evidence rows demoted: {sum(location_demotions.values()):,}")
        for (owner_name, field), count in location_demotions.most_common(15):
            print(f"  - {owner_name} [{field}]: {count:,}")
        if len(location_demotions) > 15:
            print(f"  ... {len(location_demotions) - 15:,} more identity/field pair(s)")
    sys.exit(result)
