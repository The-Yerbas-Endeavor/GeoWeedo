import 'server-only';

import { randomUUID } from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';
import { fetchScLabsSample, ingestScLabsSample, isScLabsSampleUrl } from './scLabs';
import type { RetailId1A4Record } from './retailId1a4';

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function validRetailUid(value: string | null) {
  return Boolean(value && /^1A4[A-Z0-9]{21}$/i.test(value));
}

function validHttpUrl(value: string | null) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

async function verifyCoaSource(url: string) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'GeoWeedo-WeedoFacts/0.1 (+https://geoweedo.com)' },
    });
    if (response.ok) return { ok: true, finalUrl: response.url || url, contentType: response.headers.get('content-type') || null };
    if (![405, 501].includes(response.status)) return { ok: false, finalUrl: response.url || url, contentType: response.headers.get('content-type') || null };
  } catch {}

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        Range: 'bytes=0-2047',
        'User-Agent': 'GeoWeedo-WeedoFacts/0.1 (+https://geoweedo.com)',
      },
    });
    try { await response.body?.cancel(); } catch {}
    return { ok: response.ok || response.status === 206, finalUrl: response.url || url, contentType: response.headers.get('content-type') || null };
  } catch {
    return { ok: false, finalUrl: url, contentType: null };
  }
}

function parsePotency(value: string | null, analyteName: string) {
  if (!value) return null;
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*(%|MG|G|UG|MCG)?(?:\s+PER\s+(PACKAGE|SERVING|UNIT))?/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const rawUnit = String(match[2] || '').toLowerCase();
  const per = String(match[3] || '').toLowerCase();
  return {
    groupName: 'cannabinoid',
    analyteName,
    value: number,
    unit: rawUnit ? `${rawUnit}${per ? `/${per}` : ''}` : null,
  };
}

function sourceAnalytes(source: RetailId1A4Record) {
  return [
    parsePotency(source.thcText, 'THC'),
    parsePotency(source.cbdText, 'CBD'),
  ].filter(Boolean) as Array<{ groupName: string; analyteName: string; value: number; unit: string | null }>;
}

function insertIdentifier(db: any, batchId: string, type: string, value: string | null, now: string) {
  if (!value) return;
  db.prepare(`
    INSERT OR IGNORE INTO cannabis_batch_identifiers
      (id,batch_id,identifier_type,identifier_value,verified,created_at)
    VALUES (?,?,?,?,1,?)
  `).run(`cbi-${randomUUID()}`, batchId, type, value, now);
}

function upsertCoaSource(db: any, batchId: string, source: RetailId1A4Record, coaUrl: string, now: string) {
  const existing = db.prepare(`
    SELECT id FROM cannabis_coa_sources
    WHERE batch_id=? AND source_url=?
    LIMIT 1
  `).get(batchId, coaUrl) as any;
  const payload = JSON.stringify(source);
  if (existing?.id) {
    db.prepare(`
      UPDATE cannabis_coa_sources
      SET source_type='regulatory_coa_link',
          source_name=?,
          external_id=?,
          raw_payload_json=?,
          parser_version='metrc-retail-id-coa-v1',
          fetched_at=?,
          verified=1
      WHERE id=?
    `).run(source.labName || 'Metrc Retail ID', source.retailId || source.serial || null, payload, now, existing.id);
    return;
  }
  db.prepare(`
    INSERT INTO cannabis_coa_sources
      (id,batch_id,source_type,source_name,source_url,external_id,raw_payload_json,parser_version,fetched_at,verified,created_at)
    VALUES (?,?, 'regulatory_coa_link', ?, ?, ?, ?, 'metrc-retail-id-coa-v1', ?, 1, ?)
  `).run(`coa-${randomUUID()}`, batchId, source.labName || 'Metrc Retail ID', coaUrl, source.retailId || source.serial || null, payload, now, now);
}

export async function ingestRetailIdCoaEvidence(source: RetailId1A4Record, productId: string | null) {
  ensureWeedoFactsSchema();

  const uid = clean(source.retailId)?.toUpperCase() || null;
  const coaUrl = clean(source.coaUrl);
  const labName = clean(source.labName);
  if (!productId || !validRetailUid(uid) || !coaUrl || !validHttpUrl(coaUrl) || !labName) {
    return { verifiedBatch: false, reason: 'exact_uid_coa_lab_required' as const, productId, batchId: null };
  }

  // If the regulatory COA points at an SC Labs public record, let the dedicated
  // lab adapter ingest the full certificate. That is stronger than the summary
  // exposed by Retail ID and preserves SC Labs as the original lab source.
  if (isScLabsSampleUrl(coaUrl)) {
    try {
      const sample = await fetchScLabsSample(coaUrl);
      if (!sample.uid) sample.uid = uid;
      if (!sample.batchNumber && source.batchNumber) sample.batchNumber = source.batchNumber;
      const ingested = ingestScLabsSample(sample);
      return { verifiedBatch: true, reason: 'direct_lab_adapter' as const, productId: ingested.productId, batchId: ingested.batchId, analyteCount: ingested.analyteCount, coaUrl };
    } catch {
      // Fall through to the regulatory-linked COA path. A temporary SC Labs
      // parser issue should not discard the authenticated Retail ID evidence.
    }
  }

  const checked = await verifyCoaSource(coaUrl);
  if (!checked.ok) {
    return { verifiedBatch: false, reason: 'coa_source_unreachable' as const, productId, batchId: null, coaUrl };
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  const finalCoaUrl = checked.finalUrl || coaUrl;
  const existing = db.prepare(`
    SELECT * FROM cannabis_batches
    WHERE uid=? COLLATE NOCASE
    ORDER BY verified DESC, updated_at DESC
    LIMIT 1
  `).get(uid) as any;
  const batchId = existing?.id || `cb-${randomUUID()}`;

  if (!existing) {
    db.prepare(`
      INSERT INTO cannabis_batches (
        id,product_id,batch_number,uid,coa_number,coa_url,
        lab_name,lab_license_number,producer_name,producer_license_number,
        collected_at,received_at,tested_at,overall_status,
        source_type,source_name,source_url,verified,created_at,updated_at
      ) VALUES (?,?,?,?,?, ?,?,?,?,?, NULL,NULL,?,?, 'lab',?,?,1,?,?)
    `).run(
      batchId, productId, clean(source.batchNumber), uid, clean(source.serial), finalCoaUrl,
      labName, clean(source.labLicense), clean(source.facility), clean(source.facilityLicense),
      clean(source.testedAt), clean(source.overallStatus), labName, finalCoaUrl, now, now,
    );
  } else {
    // Never weaken stronger direct-lab evidence. Fill missing identity fields and
    // promote only when this exact UID has an authenticated COA + named lab.
    db.prepare(`
      UPDATE cannabis_batches SET
        product_id=COALESCE(product_id,?),
        batch_number=COALESCE(batch_number,?),
        coa_number=COALESCE(coa_number,?),
        coa_url=COALESCE(coa_url,?),
        lab_name=COALESCE(lab_name,?),
        lab_license_number=COALESCE(lab_license_number,?),
        producer_name=COALESCE(producer_name,?),
        producer_license_number=COALESCE(producer_license_number,?),
        tested_at=COALESCE(tested_at,?),
        overall_status=COALESCE(overall_status,?),
        source_type=CASE WHEN verified=1 AND source_type='lab' THEN source_type ELSE 'lab' END,
        source_name=CASE WHEN verified=1 AND source_type='lab' THEN source_name ELSE ? END,
        source_url=CASE WHEN verified=1 AND source_type='lab' THEN source_url ELSE ? END,
        verified=1,
        updated_at=?
      WHERE id=?
    `).run(
      productId, clean(source.batchNumber), clean(source.serial), finalCoaUrl,
      labName, clean(source.labLicense), clean(source.facility), clean(source.facilityLicense),
      clean(source.testedAt), clean(source.overallStatus), labName, finalCoaUrl, now, batchId,
    );
  }

  insertIdentifier(db, batchId, 'uid', uid, now);
  insertIdentifier(db, batchId, 'qr', source.url, now);
  insertIdentifier(db, batchId, 'batch', clean(source.batchNumber), now);
  insertIdentifier(db, batchId, 'coa', clean(source.serial), now);
  upsertCoaSource(db, batchId, source, finalCoaUrl, now);

  const analytes = sourceAnalytes(source);
  if (analytes.length) {
    const insert = db.prepare(`
      INSERT INTO cannabis_analytes
        (id,batch_id,group_name,analyte_name,value,unit,lod,loq,status,limit_value,limit_unit,created_at)
      VALUES (?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,?)
    `);
    for (const row of analytes) {
      const duplicate = db.prepare(`
        SELECT id FROM cannabis_analytes
        WHERE batch_id=? AND group_name=? AND analyte_name=? COLLATE NOCASE
          AND value IS ? AND COALESCE(unit,'')=COALESCE(?, '')
        LIMIT 1
      `).get(batchId, row.groupName, row.analyteName, row.value, row.unit) as any;
      if (!duplicate) insert.run(`ca-${randomUUID()}`, batchId, row.groupName, row.analyteName, row.value, row.unit, now);
    }
  }

  return {
    verifiedBatch: true,
    reason: 'authenticated_regulatory_coa' as const,
    productId,
    batchId,
    analyteCount: analytes.length,
    coaUrl: finalCoaUrl,
    labName,
  };
}
