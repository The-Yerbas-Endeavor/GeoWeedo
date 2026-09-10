#!/usr/bin/env python3
import argparse
import ast
import csv
import hashlib
import json
import math
import re
import sqlite3
import urllib.error
import urllib.request
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

DATASET_PAGE = "https://huggingface.co/datasets/cannlytics/cannabis_results"
STATE_FILES = {
    "ca": ("xlsx", 71581), "co": ("xlsx", 25798), "ct": ("xlsx", 19963), "fl": ("xlsx", 14573),
    "hi": ("csv", 13485), "ma": ("csv", 75164), "md": ("csv", 105013), "mi": ("csv", 89956),
    "nv": ("csv", 153064), "ny": ("csv", 330), "or": ("csv", 196900), "ri": ("csv", 25832),
    "ut": ("csv", 1230), "wa": ("xlsx", 202812),
}
CANNABINOIDS = {
    "delta_9_thc": "Delta-9 THC", "delta_8_thc": "Delta-8 THC", "thca": "THCA", "total_thc": "Total THC",
    "cbd": "CBD", "cbda": "CBDA", "total_cbd": "Total CBD", "cbg": "CBG", "cbga": "CBGA",
    "cbn": "CBN", "cbc": "CBC", "cbdv": "CBDV", "thcv": "THCV", "total_cannabinoids": "Total Cannabinoids",
}
TERPENES = {
    "beta_myrcene": "Beta-Myrcene", "d_limonene": "D-Limonene", "beta_caryophyllene": "Beta-Caryophyllene",
    "alpha_pinene": "Alpha-Pinene", "beta_pinene": "Beta-Pinene", "linalool": "Linalool",
    "alpha_humulene": "Alpha-Humulene", "terpinolene": "Terpinolene", "ocimene": "Ocimene",
    "alpha_bisabolol": "Alpha-Bisabolol", "camphene": "Camphene", "geraniol": "Geraniol",
    "nerolidol": "Nerolidol", "guaiol": "Guaiol", "caryophyllene_oxide": "Caryophyllene Oxide",
    "total_terpenes": "Total Terpenes",
}
SAFETY = {
    "pesticides_status": "Pesticides", "heavy_metals_status": "Heavy metals", "microbials_status": "Microbials",
    "mycotoxins_status": "Mycotoxins", "residual_solvents_status": "Residual solvents",
    "foreign_matter_status": "Foreign matter",
}


def clean(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null", "n/a", "na"}:
        return None
    return re.sub(r"\s+", " ", text)


def key_name(value):
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower())).strip("_")


def norm(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def pick(row, *keys):
    for key in keys:
        value = clean(row.get(key_name(key)))
        if value is not None:
            return value
    return None


def number(value):
    text = clean(value)
    if text is None:
        return None
    text = text.replace(",", "").replace("%", "").strip()
    try:
        value = float(text)
        return None if math.isnan(value) or math.isinf(value) else value
    except ValueError:
        return None


def iso_date(value):
    text = clean(value)
    if text is None:
        return None
    try:
        numeric = float(text)
        if 20000 < numeric < 80000:
            return (datetime(1899, 12, 30, tzinfo=timezone.utc) + timedelta(days=numeric)).isoformat()
    except ValueError:
        pass
    try:
        date = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        return date.isoformat()
    except ValueError:
        pass
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y/%m/%d", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    return None


def normalized_row(raw):
    return {key_name(k): v for k, v in raw.items() if k is not None}


def parse_results(value):
    text = clean(value)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except Exception:
        try:
            parsed = ast.literal_eval(text)
        except Exception:
            return []
    if isinstance(parsed, dict):
        parsed = parsed.get("results") or parsed.get("analyses") or [parsed]
    return parsed if isinstance(parsed, list) else []


def status_value(value):
    text = clean(value)
    if not text:
        return None
    low = text.lower()
    if low in {"pass", "passed", "passing", "p", "compliant", "yes", "true", "1"}:
        return "pass"
    if low in {"fail", "failed", "failing", "f", "non-compliant", "no", "false", "0"}:
        return "fail"
    if low in {"nt", "not tested", "n/t", "not applicable", "n/a", "na", "-"}:
        return "nt"
    return low


def analytes_from_row(row):
    analytes = []
    seen = set()

    def add(group, name, value=None, unit=None, status=None, lod=None, loq=None, limit_value=None, limit_unit=None):
        key = (group, norm(name))
        if not name or key in seen or (value is None and status is None):
            return
        seen.add(key)
        analytes.append({
            "group": group, "name": name, "value": value, "unit": unit, "status": status,
            "lod": lod, "loq": loq, "limit_value": limit_value, "limit_unit": limit_unit,
        })

    for field, label in CANNABINOIDS.items():
        value = number(row.get(field))
        if value is not None:
            add("cannabinoid", label, value, "%")
    for field, label in TERPENES.items():
        value = number(row.get(field))
        if value is not None:
            add("terpene", label, value, "%")
    for field, label in SAFETY.items():
        status = status_value(row.get(field))
        if status:
            add("safety", label, status=status)
    moisture = number(row.get("moisture_content"))
    if moisture is not None:
        add("other", "Moisture content", moisture, "%")
    water = number(row.get("water_activity"))
    if water is not None:
        add("other", "Water activity", water, None)

    for result in parse_results(row.get("results")):
        if not isinstance(result, dict):
            continue
        normalized = {key_name(k): v for k, v in result.items()}
        analysis = clean(normalized.get("analysis")) or clean(normalized.get("analysis_type")) or "other"
        analysis_key = norm(analysis)
        if "cannabinoid" in analysis_key or "potency" in analysis_key:
            group = "cannabinoid"
        elif "terpene" in analysis_key:
            group = "terpene"
        elif any(word in analysis_key for word in ("pestic", "metal", "micro", "mycotoxin", "solvent", "foreign")):
            group = "safety"
        else:
            group = key_name(analysis) or "other"
        name = pick(normalized, "name", "key", "analyte", "analyte_name")
        units = clean(normalized.get("units")) or clean(normalized.get("unit"))
        add(group, name, number(normalized.get("value")), units, status_value(normalized.get("status")),
            number(normalized.get("lod")), number(normalized.get("loq")), number(normalized.get("limit")), units)
    return analytes


def column_index(cell_ref):
    letters = re.match(r"[A-Z]+", cell_ref or "")
    if not letters:
        return 0
    total = 0
    for char in letters.group(0):
        total = total * 26 + ord(char) - 64
    return total - 1


def iter_xlsx_rows(path):
    main_ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    rel_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
    package_rel_ns = "{http://schemas.openxmlformats.org/package/2006/relationships}"
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{main_ns}si"):
                shared.append("".join(node.text or "" for node in si.iter(f"{main_ns}t")))
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels.findall(f"{package_rel_ns}Relationship")}
        sheet_path = None
        for sheet in workbook.find(f"{main_ns}sheets") or []:
            rid = sheet.attrib.get(f"{rel_ns}id")
            target = targets.get(rid or "")
            if target:
                sheet_path = target.lstrip("/")
                if not sheet_path.startswith("xl/"):
                    sheet_path = "xl/" + sheet_path
                break
        if not sheet_path:
            raise RuntimeError("Cannlytics XLSX did not contain a worksheet.")
        headers = None
        with archive.open(sheet_path) as stream:
            for _event, elem in ET.iterparse(stream, events=("end",)):
                if elem.tag != f"{main_ns}row":
                    continue
                values = {}
                for cell in elem.findall(f"{main_ns}c"):
                    idx = column_index(cell.attrib.get("r", ""))
                    ctype = cell.attrib.get("t")
                    value_node = cell.find(f"{main_ns}v")
                    value = value_node.text if value_node is not None else None
                    if ctype == "s" and value is not None:
                        try:
                            value = shared[int(value)]
                        except Exception:
                            pass
                    elif ctype == "inlineStr":
                        value = "".join(node.text or "" for node in cell.iter(f"{main_ns}t"))
                    values[idx] = value
                if values:
                    max_idx = max(values)
                    row_values = [values.get(i) for i in range(max_idx + 1)]
                    if headers is None:
                        headers = [clean(v) or f"column_{i}" for i, v in enumerate(row_values)]
                    else:
                        yield {headers[i]: row_values[i] if i < len(row_values) else None for i in range(len(headers))}
                elem.clear()


def iter_rows(path):
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="", errors="replace") as handle:
            yield from csv.DictReader(handle)
    else:
        yield from iter_xlsx_rows(path)


def dataset_url(state, extension):
    return f"https://huggingface.co/datasets/cannlytics/cannabis_results/resolve/main/data/{state}/{state}-results-latest.{extension}?download=true"


def download_dataset(state, extension, cache_dir):
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"{state}-results-latest.{extension}"
    meta_path = cache_dir / f"{state}-results-latest.meta.json"
    meta = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
        except Exception:
            meta = {}
    headers = {"User-Agent": "GeoWeedo/1.0 Cannlytics CC-BY-4.0 importer"}
    if target.exists() and meta.get("etag"):
        headers["If-None-Match"] = meta["etag"]
    if target.exists() and meta.get("last_modified"):
        headers["If-Modified-Since"] = meta["last_modified"]
    request = urllib.request.Request(dataset_url(state, extension), headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            temp = target.with_suffix(target.suffix + ".part")
            with temp.open("wb") as out:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
            temp.replace(target)
            meta_path.write_text(json.dumps({
                "etag": response.headers.get("ETag"),
                "last_modified": response.headers.get("Last-Modified"),
                "downloaded_at": datetime.now(timezone.utc).isoformat(),
                "url": dataset_url(state, extension),
            }, indent=2))
            return target, False
    except urllib.error.HTTPError as error:
        if error.code == 304 and target.exists():
            return target, True
        raise


def stable_hash(prefix, value, length=24):
    return prefix + hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def ensure_schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS cannabis_products (
      id TEXT PRIMARY KEY, brand_name TEXT, product_name TEXT NOT NULL, product_type TEXT, net_contents TEXT,
      normalized_name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cannabis_batches (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, batch_number TEXT, uid TEXT, coa_number TEXT, coa_url TEXT,
      lab_name TEXT, lab_license_number TEXT, producer_name TEXT, producer_license_number TEXT,
      collected_at TEXT, received_at TEXT, tested_at TEXT, overall_status TEXT,
      source_type TEXT NOT NULL, source_name TEXT, source_url TEXT, verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cannabis_analytes (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, group_name TEXT NOT NULL, analyte_name TEXT NOT NULL,
      value REAL, unit TEXT, lod REAL, loq REAL, status TEXT, limit_value REAL, limit_unit TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cannabis_coa_sources (
      id TEXT PRIMARY KEY, batch_id TEXT, source_type TEXT NOT NULL, source_name TEXT, source_url TEXT,
      external_id TEXT, raw_payload_json TEXT, parser_version TEXT, fetched_at TEXT, verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cannlytics_source_records (
      external_key TEXT PRIMARY KEY, state_code TEXT NOT NULL, source_record_id TEXT NOT NULL, row_hash TEXT NOT NULL,
      batch_id TEXT, source_label TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cannlytics_state_sync (
      state_code TEXT PRIMARY KEY, upstream_records INTEGER, imported_records INTEGER NOT NULL DEFAULT 0,
      linked_existing INTEGER NOT NULL DEFAULT 0, unchanged_records INTEGER NOT NULL DEFAULT 0,
      skipped_records INTEGER NOT NULL DEFAULT 0, failed_records INTEGER NOT NULL DEFAULT 0,
      last_started_at TEXT, last_completed_at TEXT, last_error TEXT, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cannlytics_source_state_idx ON cannlytics_source_records(state_code);
    CREATE INDEX IF NOT EXISTS cannabis_coa_sources_external_idx ON cannabis_coa_sources(source_name, external_id);
    """)
    db.commit()


def candidate_existing_batch(db, sample_id, batch_number, product_name, producer):
    if sample_id:
        rows = db.execute("""
          SELECT b.id,b.source_name,p.product_name,b.producer_name
          FROM cannabis_batches b JOIN cannabis_products p ON p.id=b.product_id
          WHERE b.coa_number=? AND b.verified=1 LIMIT 3
        """, (sample_id,)).fetchall()
        matches = [row for row in rows if norm(row["product_name"]) == norm(product_name)
                   and (not producer or not row["producer_name"] or norm(row["producer_name"]) == norm(producer))]
        if len(matches) == 1:
            return matches[0]
    if batch_number:
        rows = db.execute("""
          SELECT b.id,b.source_name,p.product_name,b.producer_name
          FROM cannabis_batches b JOIN cannabis_products p ON p.id=b.product_id
          WHERE b.batch_number=? AND b.verified=1 LIMIT 20
        """, (batch_number,)).fetchall()
        matches = [row for row in rows if norm(row["product_name"]) == norm(product_name)
                   and (not producer or not row["producer_name"] or norm(row["producer_name"]) == norm(producer))]
        if len(matches) == 1:
            return matches[0]
    return None


def main():
    parser = argparse.ArgumentParser(description="Import one Cannlytics cannabis_results state dataset into GeoWeedo.")
    parser.add_argument("--state", required=True, choices=sorted(STATE_FILES))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Maximum eligible records to evaluate; 0 means all.")
    args = parser.parse_args()
    state = args.state.lower()
    extension, upstream_records = STATE_FILES[state]
    root = Path.cwd()
    cache_dir = root / "data" / "source-cache" / "cannlytics"
    db_path = root / "data" / "runtime" / "geoweodo.sqlite"
    if not db_path.exists() and not args.dry_run:
        raise SystemExit(f"GeoWeedo database not found at {db_path}")

    print(f"Cannlytics {state.upper()} source: {upstream_records:,} upstream observations | CC BY 4.0")
    print(f"Dataset: {DATASET_PAGE}")
    source_file, cached = download_dataset(state, extension, cache_dir)
    print(f"{'Using cached' if cached else 'Downloaded'} {source_file.name} ({source_file.stat().st_size / (1024*1024):.1f} MiB)")

    db = None
    if not args.dry_run:
        db = sqlite3.connect(db_path, timeout=60)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=NORMAL")
        db.execute("PRAGMA foreign_keys=ON")
        ensure_schema(db)
        now = datetime.now(timezone.utc).isoformat()
        db.execute("""
          INSERT INTO cannlytics_state_sync(state_code,upstream_records,last_started_at,last_error,updated_at)
          VALUES(?,?,?,NULL,?)
          ON CONFLICT(state_code) DO UPDATE SET upstream_records=excluded.upstream_records,
            last_started_at=excluded.last_started_at,last_error=NULL,updated_at=excluded.updated_at
        """, (state, upstream_records, now, now))
        db.commit()

    considered = imported = updated = unchanged = linked = skipped = failed = 0
    seen_external = set()
    try:
        for raw in iter_rows(source_file):
            row = normalized_row(raw)
            product_name = pick(row, "product_name", "strain_name", "product")
            if not product_name:
                skipped += 1
                continue
            sample_id = pick(row, "sample_id", "lab_id")
            batch_number = pick(row, "batch_number", "batch", "lot_number")
            record_id = pick(row, "id", "sample_hash", "results_hash", "source_id")
            date_tested = iso_date(pick(row, "date_tested", "tested_at", "test_date"))
            producer = pick(row, "producer", "producer_name", "cultivator", "manufacturer", "licensee")
            producer_license = pick(row, "producer_license_number", "producer_license", "license_number")
            brand = pick(row, "brand_name", "brand", "product_brand", "brand_owner")
            product_type = pick(row, "product_type", "product_subtype", "category")
            lab = pick(row, "lab", "lab_name", "laboratory")
            lab_license = pick(row, "lab_license_number", "lab_license")
            source_label = pick(row, "source") or f"Cannlytics {state.upper()}"
            analytes = analytes_from_row(row)
            if not analytes or not (record_id or sample_id or batch_number):
                skipped += 1
                continue

            fallback = "|".join([state, product_name, producer or "", batch_number or "", sample_id or "", date_tested or ""])
            source_record_id = record_id or stable_hash("", fallback, 32)
            external_key = f"{state}:{source_record_id}"
            if external_key in seen_external:
                skipped += 1
                continue
            seen_external.add(external_key)
            considered += 1
            if args.limit and considered > args.limit:
                break

            coa_url = pick(row, "coa_url", "lab_results_url")
            source_url = coa_url or DATASET_PAGE
            overall_status = status_value(pick(row, "overall_status", "status"))
            collected = iso_date(pick(row, "date_collected", "collected_at"))
            received = iso_date(pick(row, "date_received", "received_at"))
            payload = {
                "state": state, "external_id": source_record_id, "product_name": product_name, "product_type": product_type,
                "brand": brand, "producer": producer, "producer_license": producer_license, "batch_number": batch_number,
                "sample_id": sample_id, "lab": lab, "lab_license": lab_license, "tested_at": date_tested,
                "collected_at": collected, "received_at": received, "overall_status": overall_status,
                "source": source_label, "source_url": source_url, "analytes": analytes,
            }
            row_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

            if args.dry_run:
                if considered <= 25:
                    print(f"WOULD IMPORT {state.upper()}: {brand or 'brand not reported'} | {product_name} | "
                          f"licensed business: {producer or 'not reported'} | {sample_id or batch_number or source_record_id} | "
                          f"{len(analytes)} analytes")
                imported += 1
                continue

            existing_map = db.execute("SELECT batch_id,row_hash,first_seen_at FROM cannlytics_source_records WHERE external_key=?", (external_key,)).fetchone()
            now = datetime.now(timezone.utc).isoformat()
            if existing_map and existing_map["row_hash"] == row_hash:
                db.execute("UPDATE cannlytics_source_records SET last_seen_at=?,updated_at=? WHERE external_key=?", (now, now, external_key))
                unchanged += 1
                if considered % 500 == 0:
                    db.commit()
                continue

            direct = candidate_existing_batch(db, sample_id, batch_number, product_name, producer)
            if direct and direct["source_name"] != "Cannlytics":
                batch_id = direct["id"]
                linked += 1
            else:
                identity_owner = brand or producer or ""
                product_id = stable_hash("cp-cann-", "|".join([norm(identity_owner), norm(product_name), norm(product_type)]))
                batch_id = direct["id"] if direct else stable_hash("cb-cann-", external_key)
                db.execute("""
                  INSERT INTO cannabis_products(id,brand_name,product_name,product_type,net_contents,normalized_name,created_at,updated_at)
                  VALUES(?,?,?,?,NULL,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET
                    brand_name=COALESCE(excluded.brand_name,cannabis_products.brand_name),
                    product_name=excluded.product_name,
                    product_type=COALESCE(excluded.product_type,cannabis_products.product_type),
                    normalized_name=excluded.normalized_name,updated_at=excluded.updated_at
                """, (product_id, brand, product_name, product_type, norm(f"{brand or ''} {product_name}"), now, now))
                db.execute("""
                  INSERT INTO cannabis_batches(
                    id,product_id,batch_number,uid,coa_number,coa_url,lab_name,lab_license_number,
                    producer_name,producer_license_number,collected_at,received_at,tested_at,overall_status,
                    source_type,source_name,source_url,verified,created_at,updated_at
                  ) VALUES(?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,'public_dataset','Cannlytics',?,1,?,?)
                  ON CONFLICT(id) DO UPDATE SET
                    product_id=excluded.product_id,batch_number=excluded.batch_number,coa_number=excluded.coa_number,
                    coa_url=excluded.coa_url,lab_name=excluded.lab_name,lab_license_number=excluded.lab_license_number,
                    producer_name=excluded.producer_name,producer_license_number=excluded.producer_license_number,
                    collected_at=excluded.collected_at,received_at=excluded.received_at,tested_at=excluded.tested_at,
                    overall_status=excluded.overall_status,source_url=excluded.source_url,verified=1,updated_at=excluded.updated_at
                """, (batch_id, product_id, batch_number, sample_id, coa_url, lab, lab_license, producer, producer_license,
                      collected, received, date_tested, overall_status, source_url, now, now))
                db.execute("DELETE FROM cannabis_analytes WHERE batch_id=?", (batch_id,))
                for analyte in analytes:
                    db.execute("""
                      INSERT INTO cannabis_analytes(
                        id,batch_id,group_name,analyte_name,value,unit,lod,loq,status,limit_value,limit_unit,created_at
                      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                    """, ("ca-" + str(uuid.uuid4()), batch_id, analyte["group"], analyte["name"], analyte["value"],
                          analyte["unit"], analyte["lod"], analyte["loq"], analyte["status"],
                          analyte["limit_value"], analyte["limit_unit"], now))
                if existing_map:
                    updated += 1
                else:
                    imported += 1

            db.execute("DELETE FROM cannabis_coa_sources WHERE source_name='Cannlytics' AND external_id=?", (external_key,))
            db.execute("""
              INSERT INTO cannabis_coa_sources(
                id,batch_id,source_type,source_name,source_url,external_id,raw_payload_json,parser_version,fetched_at,verified,created_at
              ) VALUES(?,?,'public_dataset','Cannlytics',?,?,NULL,'cannlytics-v1',?,1,?)
            """, ("cs-" + str(uuid.uuid4()), batch_id, source_url, external_key, now, now))
            first_seen = existing_map["first_seen_at"] if existing_map else now
            db.execute("""
              INSERT INTO cannlytics_source_records(
                external_key,state_code,source_record_id,row_hash,batch_id,source_label,first_seen_at,last_seen_at,updated_at
              ) VALUES(?,?,?,?,?,?,?,?,?)
              ON CONFLICT(external_key) DO UPDATE SET row_hash=excluded.row_hash,batch_id=excluded.batch_id,
                source_label=excluded.source_label,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at
            """, (external_key, state, source_record_id, row_hash, batch_id, source_label, first_seen, now, now))
            if considered % 500 == 0:
                db.commit()

        if db:
            db.commit()
            total_imported = db.execute("SELECT COUNT(*) FROM cannlytics_source_records WHERE state_code=?", (state,)).fetchone()[0]
            completed = datetime.now(timezone.utc).isoformat()
            db.execute("""
              INSERT INTO cannlytics_state_sync(
                state_code,upstream_records,imported_records,linked_existing,unchanged_records,skipped_records,failed_records,
                last_completed_at,last_error,updated_at
              ) VALUES(?,?,?,?,?,?,?,?,NULL,?)
              ON CONFLICT(state_code) DO UPDATE SET upstream_records=excluded.upstream_records,
                imported_records=excluded.imported_records,linked_existing=excluded.linked_existing,
                unchanged_records=excluded.unchanged_records,skipped_records=excluded.skipped_records,
                failed_records=excluded.failed_records,last_completed_at=excluded.last_completed_at,last_error=NULL,updated_at=excluded.updated_at
            """, (state, upstream_records, total_imported, linked, unchanged, skipped, failed, completed, completed))
            db.commit()
    except Exception as error:
        if db:
            db.rollback()
            failed += 1
            now = datetime.now(timezone.utc).isoformat()
            db.execute("""
              INSERT INTO cannlytics_state_sync(state_code,upstream_records,failed_records,last_completed_at,last_error,updated_at)
              VALUES(?,?,?,?,?,?)
              ON CONFLICT(state_code) DO UPDATE SET failed_records=excluded.failed_records,
                last_completed_at=excluded.last_completed_at,last_error=excluded.last_error,updated_at=excluded.updated_at
            """, (state, upstream_records, failed, now, str(error)[:2000], now))
            db.commit()
        raise
    finally:
        if db:
            db.close()

    print("\nCannlytics import summary")
    print(f"  state: {state.upper()}")
    print(f"  upstream observations: {upstream_records:,}")
    print(f"  considered: {min(considered, args.limit) if args.limit else considered:,}")
    print(f"  {'eligible' if args.dry_run else 'new records'}: {imported:,}")
    if not args.dry_run:
        print(f"  updated records: {updated:,}")
        print(f"  unchanged records: {unchanged:,}")
        print(f"  linked to stronger existing lab evidence: {linked:,}")
    print(f"  skipped incomplete/duplicate: {skipped:,}")
    print(f"  failed: {failed:,}")
    print("  Attribution: Cannlytics Cannabis Results Dataset, CC BY 4.0; normalized by GeoWeedo.")


if __name__ == "__main__":
    main()
