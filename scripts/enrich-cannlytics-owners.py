#!/usr/bin/env python3
"""Conservative owner enrichment for Cannlytics-created GeoWeedo products.

This is a data-quality tool, not a product merge tool.

Dry-run is the default. It inspects Cannlytics products that currently have no
brand and no mapped producer, extracts structured owner evidence from the raw
Cannlytics payload already stored with the COA source, and classifies each
product without changing canonical product identity.

With --apply it writes only derived provenance tables:
  cannabis_product_owner_evidence
  cannabis_product_owner_resolution

It never rewrites cannabis_products.brand_name, product IDs, batches, analytes,
COAs, identifiers, variants, menus, or scan history.
"""

import argparse
import hashlib
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
DEFAULT_BACKUP_DIR = Path.home() / "geoweedo-db-backups"
RESOLVER_VERSION = 1

# Exact normalized field names only. Generic business/facility fields are kept
# review-only because in regulatory datasets they can describe a lab or other
# intermediary rather than the product owner.
FIELD_RULES = {
    # Consumer-facing brand evidence.
    "brand": ("brand", 1.00),
    "brand_name": ("brand", 1.00),
    "brandname": ("brand", 1.00),
    "product_brand": ("brand", 1.00),

    # Direct production/cultivation evidence.
    "producer": ("producer", 0.95),
    "producer_name": ("producer", 0.95),
    "producer_legal_name": ("producer", 0.95),
    "producer_business_name": ("producer", 0.95),
    "producer_company": ("producer", 0.95),
    "producer_dba": ("producer", 0.95),
    "cultivator": ("cultivator", 0.95),
    "cultivator_name": ("cultivator", 0.95),
    "grower": ("cultivator", 0.95),
    "grower_name": ("cultivator", 0.95),
    "farm": ("cultivator", 0.93),
    "farm_name": ("cultivator", 0.93),

    # Manufacturing/processing evidence.
    "manufacturer": ("manufacturer", 0.92),
    "manufacturer_name": ("manufacturer", 0.92),
    "manufacturing_facility": ("manufacturer", 0.90),
    "manufacturing_business": ("manufacturer", 0.90),
    "processor": ("processor", 0.92),
    "processor_name": ("processor", 0.92),
    "processor_business_name": ("processor", 0.92),

    # Regulatory owner/license-holder evidence. Review-only unless stronger
    # evidence independently resolves the same product.
    "licensee": ("licensee", 0.82),
    "licensee_name": ("licensee", 0.82),
    "license_holder": ("licensee", 0.82),
    "license_holder_name": ("licensee", 0.82),
    "registrant": ("licensee", 0.80),
    "registrant_name": ("licensee", 0.80),
    "owner": ("licensee", 0.80),
    "owner_name": ("licensee", 0.80),

    # Weak generic evidence: useful to queue for review, never auto-resolved.
    "business_name": ("business", 0.65),
    "company_name": ("business", 0.65),
    "organization": ("business", 0.65),
    "organization_name": ("business", 0.65),
    "facility_name": ("business", 0.60),
}

PLACEHOLDERS = {
    "unknown", "not reported", "not provided", "not available", "n a", "na",
    "none", "null", "tbd", "unavailable", "unbranded", "no brand", "other",
}


def norm(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def key_name(value):
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(value or "").lower())).strip("_")


def clean_display(value):
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text or None


def stable_id(prefix, *parts, length=24):
    payload = "|".join(str(part or "") for part in parts)
    return prefix + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:length]


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
    output = backup_dir / f"geoweedo.sqlite.pre-cannlytics-owner-enrichment-{stamp}.bak"
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


def flatten_json(value, path=()):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from flatten_json(child, (*path, key_name(key)))
    elif isinstance(value, list):
        # Owner metadata occasionally lives inside a single metadata object.
        # Traverse objects but avoid treating scalar result arrays as evidence.
        for child in value:
            if isinstance(child, (dict, list)):
                yield from flatten_json(child, path)
    elif path:
        yield path, value


def plausible_owner(value):
    display = clean_display(value)
    if not display or len(display) < 3 or len(display) > 180:
        return None
    normalized = norm(display)
    if not normalized or normalized in PLACEHOLDERS:
        return None
    # Require at least one letter. This rejects license numbers and numeric IDs.
    if not re.search(r"[a-z]", normalized):
        return None
    return display, normalized


def extract_payload_evidence(raw_payload, *, product_id, product_name, batch_id, state_code, external_id, lab_name):
    if not raw_payload:
        return []
    try:
        payload = json.loads(raw_payload)
    except Exception:
        return []

    evidence = []
    normalized_lab = norm(lab_name)
    normalized_product = norm(product_name)
    seen = set()

    for path, raw_value in flatten_json(payload):
        leaf = path[-1]
        rule = FIELD_RULES.get(leaf)
        if not rule:
            continue

        # Never treat fields nested below obvious lab/tester namespaces as owner
        # evidence. This matters for generic business_name/facility_name keys.
        path_text = "_".join(path)
        if any(token in path_text for token in ("lab_", "laboratory_", "testing_lab", "tester_")):
            continue

        parsed = plausible_owner(raw_value)
        if not parsed:
            continue
        display, normalized = parsed
        if normalized_lab and normalized == normalized_lab:
            continue
        if normalized_product and normalized == normalized_product and rule[1] < 0.90:
            continue

        owner_type, confidence = rule
        dedupe_key = (batch_id, owner_type, normalized, leaf)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        evidence.append({
            "id": stable_id("cpoe-", product_id, batch_id, owner_type, normalized, leaf, external_id),
            "product_id": product_id,
            "batch_id": batch_id,
            "state_code": state_code,
            "owner_name": display,
            "normalized_owner_name": normalized,
            "owner_type": owner_type,
            "evidence_field": leaf,
            "evidence_source": "Cannlytics",
            "confidence": confidence,
            "source_external_id": external_id,
        })
    return evidence


def choose_display(rows, normalized_name):
    options = Counter(row["owner_name"] for row in rows if row["normalized_owner_name"] == normalized_name)
    return options.most_common(1)[0][0] if options else normalized_name


def resolve_product(context):
    rows = context["evidence"]
    strong = [row for row in rows if row["confidence"] >= 0.90]
    medium = [row for row in rows if 0.80 <= row["confidence"] < 0.90]
    weak = [row for row in rows if row["confidence"] < 0.80]

    strong_names = {row["normalized_owner_name"] for row in strong}
    medium_names = {row["normalized_owner_name"] for row in medium}
    weak_names = {row["normalized_owner_name"] for row in weak}

    status = "missing"
    chosen = None
    pool = []
    if len(strong_names) == 1:
        status = "resolved"
        chosen = next(iter(strong_names))
        pool = [row for row in strong if row["normalized_owner_name"] == chosen]
    elif len(strong_names) > 1:
        status = "ambiguous"
    elif len(medium_names) == 1:
        chosen_medium = next(iter(medium_names))
        medium_rows = [row for row in medium if row["normalized_owner_name"] == chosen_medium]
        distinct_batches = {row["batch_id"] for row in medium_rows if row["batch_id"]}
        # Medium regulatory evidence is useful but intentionally review-only.
        status = "review"
        chosen = chosen_medium
        pool = medium_rows
        if len(distinct_batches) < 2:
            status = "review"
    elif len(medium_names) > 1:
        status = "ambiguous"
    elif weak_names:
        status = "review"
        if len(weak_names) == 1:
            chosen = next(iter(weak_names))
            pool = [row for row in weak if row["normalized_owner_name"] == chosen]

    candidate_names = strong_names | medium_names | weak_names
    all_batches = {row["batch_id"] for row in rows if row["batch_id"]}
    resolution = {
        "product_id": context["product_id"],
        "product_name": context["product_name"],
        "product_type": context["product_type"],
        "batch_count": context["batch_count"],
        "states": sorted(context["states"]),
        "status": status,
        "owner_name": None,
        "normalized_owner_name": chosen,
        "owner_type": None,
        "confidence": None,
        "evidence_count": len(rows),
        "distinct_batch_count": len(all_batches),
        "candidate_count": len(candidate_names),
    }
    if chosen and pool:
        best_confidence = max(row["confidence"] for row in pool)
        best_rows = [row for row in pool if row["confidence"] == best_confidence]
        type_counts = Counter(row["owner_type"] for row in best_rows)
        resolution.update({
            "owner_name": choose_display(pool, chosen),
            "owner_type": type_counts.most_common(1)[0][0],
            "confidence": best_confidence,
        })
    return resolution


def load_contexts(db):
    """Load exactly the products classified as missing-owner by reconciliation v3."""
    contexts = {}
    sql = """
      WITH missing AS (
        SELECT p.id
        FROM cannabis_products p
        JOIN cannabis_batches b ON b.product_id=p.id AND b.source_name='Cannlytics'
        WHERE p.id LIKE 'cp-cann-%'
          AND COALESCE(TRIM(p.brand_name),'')=''
        GROUP BY p.id
        HAVING SUM(CASE WHEN COALESCE(TRIM(b.producer_name),'')<>'' THEN 1 ELSE 0 END)=0
      )
      SELECT
        p.id AS product_id,p.product_name,p.product_type,
        b.id AS batch_id,b.lab_name,
        cs.external_id,cs.raw_payload_json,
        sr.state_code
      FROM missing m
      JOIN cannabis_products p ON p.id=m.id
      JOIN cannabis_batches b ON b.product_id=p.id AND b.source_name='Cannlytics'
      LEFT JOIN cannabis_coa_sources cs
        ON cs.batch_id=b.id AND cs.source_name='Cannlytics'
      LEFT JOIN cannlytics_source_records sr ON sr.batch_id=b.id
      ORDER BY p.id,b.id
    """
    for row in db.execute(sql):
        product_id = str(row["product_id"])
        item = contexts.setdefault(product_id, {
            "product_id": product_id,
            "product_name": row["product_name"],
            "product_type": row["product_type"],
            "batch_ids": set(),
            "states": set(),
            "payload_rows": 0,
            "payload_errors": 0,
            "evidence": [],
        })
        batch_id = str(row["batch_id"])
        item["batch_ids"].add(batch_id)
        if row["state_code"]:
            item["states"].add(str(row["state_code"]).upper())
        if row["raw_payload_json"]:
            item["payload_rows"] += 1
            before = len(item["evidence"])
            extracted = extract_payload_evidence(
                row["raw_payload_json"],
                product_id=product_id,
                product_name=row["product_name"],
                batch_id=batch_id,
                state_code=str(row["state_code"] or "").upper() or None,
                external_id=row["external_id"],
                lab_name=row["lab_name"],
            )
            item["evidence"].extend(extracted)
            # A non-empty payload with no owner field is not an error; malformed
            # JSON is counted separately below by a lightweight parse check.
            try:
                json.loads(row["raw_payload_json"])
            except Exception:
                item["payload_errors"] += 1
        item["batch_count"] = len(item["batch_ids"])

    # Deduplicate evidence caused by multiple source-record joins for one batch.
    for item in contexts.values():
        unique = {}
        for row in item["evidence"]:
            unique[row["id"]] = row
        item["evidence"] = list(unique.values())
    return contexts


def ensure_schema(db):
    db.executescript("""
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
      );
      CREATE INDEX IF NOT EXISTS idx_product_owner_evidence_product
        ON cannabis_product_owner_evidence(product_id);
      CREATE INDEX IF NOT EXISTS idx_product_owner_evidence_owner
        ON cannabis_product_owner_evidence(normalized_owner_name,owner_type);

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
      );
      CREATE INDEX IF NOT EXISTS idx_product_owner_resolution_status
        ON cannabis_product_owner_resolution(status,confidence);
    """)


def apply_results(db, contexts, resolutions):
    now = datetime.now(timezone.utc).isoformat()
    ensure_schema(db)
    # Versioned replacement makes the resolver rerunnable without accumulating
    # stale evidence. Other evidence sources/versions remain untouched.
    db.execute(
        "DELETE FROM cannabis_product_owner_evidence WHERE evidence_source='Cannlytics' AND resolver_version=?",
        (RESOLVER_VERSION,),
    )
    db.execute(
        "DELETE FROM cannabis_product_owner_resolution WHERE resolver_version=?",
        (RESOLVER_VERSION,),
    )

    evidence_rows = 0
    for item in contexts.values():
        for row in item["evidence"]:
            db.execute("""
              INSERT INTO cannabis_product_owner_evidence(
                id,product_id,batch_id,state_code,owner_name,normalized_owner_name,
                owner_type,evidence_field,evidence_source,confidence,source_external_id,
                resolver_version,first_seen_at,last_seen_at
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                row["id"],row["product_id"],row["batch_id"],row["state_code"],row["owner_name"],
                row["normalized_owner_name"],row["owner_type"],row["evidence_field"],row["evidence_source"],
                row["confidence"],row["source_external_id"],RESOLVER_VERSION,now,now,
            ))
            evidence_rows += 1

    for row in resolutions:
        db.execute("""
          INSERT INTO cannabis_product_owner_resolution(
            product_id,status,owner_name,normalized_owner_name,owner_type,confidence,
            evidence_count,distinct_batch_count,candidate_count,resolver_version,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        """, (
            row["product_id"],row["status"],row["owner_name"],row["normalized_owner_name"],
            row["owner_type"],row["confidence"],row["evidence_count"],row["distinct_batch_count"],
            row["candidate_count"],RESOLVER_VERSION,now,
        ))
    return evidence_rows


def print_samples(title, rows, limit):
    print(f"\n{title}: {len(rows):,}")
    for row in rows[:limit]:
        owner = row["owner_name"] or "—"
        confidence = f"{row['confidence']:.2f}" if row["confidence"] is not None else "—"
        states = ",".join(row["states"]) or "?"
        print(
            f"  - {row['product_id']} | {row['product_name']} | owner={owner} | "
            f"type={row['owner_type'] or '—'} | confidence={confidence} | "
            f"evidence={row['evidence_count']} | batches={row['batch_count']} | states={states}"
        )
    if len(rows) > limit:
        print(f"  ... {len(rows)-limit:,} more not shown")


def main():
    parser = argparse.ArgumentParser(description="Audit/enrich missing Cannlytics product owner metadata.")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--backup-dir", default=str(DEFAULT_BACKUP_DIR))
    parser.add_argument("--apply", action="store_true", help="Write derived owner evidence/resolution tables.")
    parser.add_argument("--details-limit", type=int, default=15)
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    if not db_path.exists():
        raise SystemExit(f"GeoWeedo database not found: {db_path}")

    workers = cannlytics_workers()
    if workers and args.apply:
        print("Active Cannlytics process(es) detected:")
        for pid, command in workers:
            print(f"  PID {pid}: {command}")
        raise SystemExit("Refusing --apply while Cannlytics is running. Stop the importer first.")

    print("Scanning missing-owner Cannlytics products and preserved raw payloads...")
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=120)
    db.row_factory = sqlite3.Row
    contexts = load_contexts(db)
    db.close()

    resolutions = [resolve_product(item) for item in contexts.values()]
    resolutions.sort(key=lambda row: (row["status"], -(row["confidence"] or 0), -row["batch_count"], row["product_name"] or ""))

    groups = defaultdict(list)
    for row in resolutions:
        groups[row["status"]].append(row)

    total_batches = sum(item["batch_count"] for item in contexts.values())
    payload_products = sum(1 for item in contexts.values() if item["payload_rows"])
    malformed_payloads = sum(item["payload_errors"] for item in contexts.values())
    evidence_rows = sum(len(item["evidence"]) for item in contexts.values())

    print("Cannlytics owner enrichment v1")
    print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'}")
    print(f"Database: {db_path}")
    print(f"Missing-owner products: {len(contexts):,}")
    print(f"Cannlytics batches represented: {total_batches:,}")
    print(f"Products with preserved raw payloads: {payload_products:,}")
    print(f"Malformed raw payload rows: {malformed_payloads:,}")
    print(f"Owner-evidence rows extracted: {evidence_rows:,}")
    print(f"Strongly resolved: {len(groups['resolved']):,}")
    print(f"Needs review: {len(groups['review']):,}")
    print(f"Ambiguous evidence: {len(groups['ambiguous']):,}")
    print(f"Still missing evidence: {len(groups['missing']):,}")

    limit = max(0, args.details_limit)
    print_samples("Strong owner resolutions", groups["resolved"], limit)
    print_samples("Owner candidates requiring review", groups["review"], limit)
    print_samples("Conflicting owner evidence", groups["ambiguous"], limit)

    if groups["resolved"]:
        owners = Counter(row["owner_name"] for row in groups["resolved"] if row["owner_name"])
        print("\nTop strongly resolved owners:")
        for owner, count in owners.most_common(limit):
            print(f"  - {owner}: {count:,} product(s)")

    print("\nSafety")
    print("  - No brand_name fields are changed.")
    print("  - No product IDs are changed or merged.")
    print("  - No batches, COAs, analytes, identifiers, variants, menus, or scan history are changed.")
    print("  - Medium/weak evidence remains review-only.")
    print("  - Conflicting strong evidence remains ambiguous.")

    if not args.apply:
        print("\nDRY RUN ONLY — no database changes were made.")
        print("After reviewing these counts, rerun with --apply while Cannlytics is stopped to persist derived provenance only.")
        return 0

    backup_dir = Path(args.backup_dir).expanduser().resolve()
    backup = create_backup(db_path, backup_dir)
    print(f"\nBackup created: {backup}")

    db = sqlite3.connect(db_path, timeout=120)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        db.execute("BEGIN IMMEDIATE")
        written = apply_results(db, contexts, resolutions)
        fk_issues = db.execute("PRAGMA foreign_key_check").fetchall()
        if fk_issues:
            raise RuntimeError(f"Foreign-key check failed with {len(fk_issues)} issue(s): {fk_issues[:10]}")
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print("\nOwner enrichment provenance saved.")
    print(f"Evidence rows written: {written:,}")
    print(f"Resolution rows written: {len(resolutions):,}")
    print("Canonical product identity remains unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
