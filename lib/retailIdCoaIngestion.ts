import 'server-only';

import { randomUUID } from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';
import { fetchScLabsSample, ingestScLabsSample, isScLabsSampleUrl } from './scLabs';
import { matchOfficialCoaAdapter } from './weedoFactsSourceAdapters';
import type { RetailId1A4Analyte, RetailId1A4Record } from './retailId1a4';

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

function embeddedCoaData(source: RetailId1A4Record) {
  const raw = source.rawPayload as any;
  const data = raw?.coaCard?.data;
  if (data && typeof data === 'object') return data as Record<string, any>;
  if (typeof data !== 'string' || !data.trim()) return null;
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
}

function sourceOverallStatus(source: RetailId1A4Record) {
  return clean(source.overallStatus) || clean(embeddedCoaData(source)?.labTestingStateName);
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

function sourceAnalytes(source: RetailId1A4Record): RetailId1A4Analyte[] {
  if (Array.isArray(source.analytes) && source.analytes.length) return source.analytes;
  return [
    parsePotency(source.thcText, 'Total THC'),
    parsePotency(source.cbdText, 'Total CBD'),
  ].filter(Boolean) as RetailId1A4Analyte[];
}

function insertIdentifier(db: any, batchId: string, type: string, value: string | null, now: string, verified = false) {
  if (!value) return;
  db.prepare(`
    INSERT OR IGNORE INTO cannabis_batch_identifiers
      (id,batch_id,identifier_type,identifier_value,verified,created_at)
    VALUES (?,?,?,?,?,?)
  `).run(`cbi-${randomUUID()}`, batchId, type, value, verified ? 1 : 0, now);
}

function enrichVerifiedProduct(db: any, productId: string, source: RetailId1A4Record, now: string) {
  const product = db.prepare('SELECT * FROM cannabis_products WHERE id=? LIMIT 1').get(productId) as any;
  if (!product) return [] as string[];

  const incomingBrand = clean(source.brandName);
  const incomingType = clean(source.productType);
  const incomingContents = clean(source.netContents);
  const nextBrand = clean(product.brand_name) || incomingBrand;
  const nextType = clean(product.product_type) || incomingType;
  const nextContents = clean(product.net_contents) || incomingContents;
  const normalized = `${nextBrand || ''} ${product.product_name}`.trim().toLowerCase();
  const changed: string[] = [];

  if (!clean(product.brand_name) && incomingBrand) changed.push('brand_name');
  if (!clean(product.product_type) && incomingType) changed.push('product_type');
  if (!clean(product.net_contents) && incomingContents) changed.push('net_contents');
  if (normalized !== product.normalized_name) changed.push('normalized_name');

  if (changed.length) {
    db.prepare(`UPDATE cannabis_products
      SET brand_name=?, product_type=?, net_contents=?, normalized_name=?, updated_at=?
      WHERE id=?`)
      .run(nextBrand, nextType, nextContents, normalized, now, productId);
  }
  return changed;
}

function upsertCoaSource(db: any, batchId: string, source: RetailId1A4Record, sourceUrl: string, now: string, verified = false) {
  const externalId = clean(source.coaNumber ?? source.coaDocumentId ?? source.retailId ?? source.serial);
  const existing = externalId
    ? db.prepare(`
        SELECT id,source_url FROM cannabis_coa_sources
        WHERE batch_id=? AND external_id=? COLLATE NOCASE
        ORDER BY verified DESC, fetched_at DESC
        LIMIT 1
      `).get(batchId, externalId) as any
    : db.prepare(`
        SELECT id,source_url FROM cannabis_coa_sources
        WHERE batch_id=? AND source_url=?
        ORDER BY verified DESC, fetched_at DESC
        LIMIT 1
      `).get(batchId, sourceUrl) as any;
  const payload = JSON.stringify(source.rawPayload ?? source);
  const sourceType = source.coaUrl ? 'regulatory_coa_link' : 'regulatory_lab_payload';
  if (existing?.id) {
    db.prepare(`
      UPDATE cannabis_coa_sources
      SET source_type=?,
          source_name=?,
          source_url=CASE WHEN source_url IS NULL OR source_url='' THEN ? ELSE source_url END,
          external_id=?,
          raw_payload_json=?,
          parser_version='metrc-retail-id-api-v2',
          fetched_at=?,
          verified=?,
          evidence_status=?,
          evidence_reason=?
      WHERE id=?
    `).run(sourceType, source.labName || 'Metrc Retail ID', sourceUrl, externalId, payload, now, verified ? 1 : 0, verified ? 'verified' : 'source_backed', verified ? 'official_coa_link' : 'regulatory_source', existing.id);
    return existing.id as string;
  }
  const id = `coa-${randomUUID()}`;
  db.prepare(`
    INSERT INTO cannabis_coa_sources
      (id,batch_id,source_type,source_name,source_url,external_id,raw_payload_json,parser_version,fetched_at,verified,evidence_status,evidence_reason,created_at)
    VALUES (?,?,?,?,?,?,?,'metrc-retail-id-api-v2',?,?,?,?,?)
  `).run(id, batchId, sourceType, source.labName || 'Metrc Retail ID', sourceUrl, externalId, payload, now, verified ? 1 : 0, verified ? 'verified' : 'source_backed', verified ? 'official_coa_link' : 'regulatory_source', now);
  return id;
}

export async function ingestRetailIdCoaEvidence(source: RetailId1A4Record, productId: string | null) {
  ensureWeedoFactsSchema();

  const uid = clean(source.retailId)?.toUpperCase() || null;
  const coaUrl = clean(source.coaUrl);
  const labName = clean(source.labName);
  const coaDocumentId = clean(source.coaDocumentId ?? source.coaNumber);
  const overallStatus = sourceOverallStatus(source);
  const embeddedLabCoa = Boolean(validRetailUid(uid) && labName && coaDocumentId);

  if (!productId || !validRetailUid(uid) || !labName || (!embeddedLabCoa && (!coaUrl || !validHttpUrl(coaUrl)))) {
    return {
      verifiedBatch: false,
      reason: 'exact_uid_lab_coa_required' as const,
      productId,
      batchId: null,
      coaDocumentId,
    };
  }

  // If Retail ID points directly at an SC Labs public record, use the dedicated
  // lab adapter so we preserve the richest original-lab payload available.
  if (coaUrl && isScLabsSampleUrl(coaUrl)) {
    try {
      const sample = await fetchScLabsSample(coaUrl);
      if (!sample.uid) sample.uid = uid;
      if (!sample.batchNumber && source.batchNumber) sample.batchNumber = source.batchNumber;
      const ingested = ingestScLabsSample(sample);
      return {
        verifiedBatch: true,
        reason: 'direct_lab_adapter' as const,
        productId: ingested.productId,
        batchId: ingested.batchId,
        analyteCount: ingested.analyteCount,
        coaUrl,
      };
    } catch {
      // The structured Retail ID lab payload below is still usable evidence even
      // if a downstream lab-page parser temporarily fails.
    }
  }

  let finalSourceUrl = source.url;
  let officialCoaVerified = false;
  if (coaUrl) {
    const checked = await verifyCoaSource(coaUrl);
    if (checked.ok) {
      finalSourceUrl = checked.finalUrl || coaUrl;
      // Reachability is not verification. Only a source-specific adapter that
      // GeoWeedo explicitly knows how to validate may promote evidence.
      const adapter = matchOfficialCoaAdapter(finalSourceUrl) || matchOfficialCoaAdapter(coaUrl);
      officialCoaVerified = Boolean(adapter?.verification === 'official_lab_source' && embeddedLabCoa);
    } else if (!embeddedLabCoa) {
      return {
        verifiedBatch: false,
        reason: 'coa_source_unreachable' as const,
        productId,
        batchId: null,
        coaUrl,
      };
    }
  }

  // Retail ID is valuable regulatory/source-backed evidence, but a reachable
  // arbitrary COA URL is never enough to mint Verified COA. Promotion happens
  // only through an explicit official-lab adapter (the dedicated adapter path
  // above normally handles it and preserves the richest original payload).
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = db.prepare(`
    SELECT * FROM cannabis_batches
    WHERE uid=? COLLATE NOCASE
    ORDER BY verified DESC, updated_at DESC
    LIMIT 1
  `).get(uid) as any;
  const batchId = existing?.id || `cb-${randomUUID()}`;
  const coaNumber = clean(source.coaNumber ?? source.coaDocumentId);
  const analytes = sourceAnalytes(source);

  db.exec('BEGIN IMMEDIATE');
  try {
    if (!existing) {
      db.prepare(`
        INSERT INTO cannabis_batches (
          id,product_id,batch_number,uid,coa_number,coa_url,
          lab_name,lab_license_number,producer_name,producer_license_number,
          collected_at,received_at,tested_at,overall_status,
          source_type,source_name,source_url,verified,evidence_status,evidence_reason,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?, 'regulatory',?,?,0,'source_backed','regulatory_source',?,?)
      `).run(batchId, productId, clean(source.batchNumber), uid, coaNumber, coaUrl || source.url,
        labName, clean(source.labLicense), clean(source.facility), clean(source.facilityLicense),
        clean(source.testedAt), overallStatus, 'Metrc Retail ID', finalSourceUrl, now, now);
    } else if (String(existing.evidence_status || '') !== 'verified') {
      db.prepare(`UPDATE cannabis_batches SET
        batch_number=COALESCE(batch_number,?), coa_number=COALESCE(coa_number,?),
        coa_url=COALESCE(coa_url,?), lab_name=COALESCE(lab_name,?),
        lab_license_number=COALESCE(lab_license_number,?), producer_name=COALESCE(producer_name,?),
        producer_license_number=COALESCE(producer_license_number,?), tested_at=COALESCE(tested_at,?),
        overall_status=COALESCE(overall_status,?), source_type='regulatory',
        source_name='Metrc Retail ID', source_url=?, verified=?,
        evidence_status=?, evidence_reason=?, updated_at=?
        WHERE id=?`).run(clean(source.batchNumber), coaNumber, coaUrl || source.url, labName,
          clean(source.labLicense), clean(source.facility), clean(source.facilityLicense),
          clean(source.testedAt), overallStatus, finalSourceUrl, officialCoaVerified ? 1 : 0,
          officialCoaVerified ? 'verified' : 'source_backed',
          officialCoaVerified ? 'official_coa_link' : 'regulatory_source', now, batchId);
    }

    insertIdentifier(db, batchId, 'uid', uid, now, officialCoaVerified);
    insertIdentifier(db, batchId, 'qr', source.url, now, officialCoaVerified);
    insertIdentifier(db, batchId, 'batch', clean(source.batchNumber), now, officialCoaVerified);
    insertIdentifier(db, batchId, 'coa', coaNumber, now, officialCoaVerified);
    const coaSourceId = upsertCoaSource(db, batchId, source, finalSourceUrl, now, officialCoaVerified);

    const removeCanonicalAnalyte = db.prepare(`DELETE FROM cannabis_analytes
      WHERE batch_id=? AND group_name=? COLLATE NOCASE AND analyte_name=? COLLATE NOCASE`);
    const insert = db.prepare(`INSERT INTO cannabis_analytes
      (id,batch_id,group_name,analyte_name,value,unit,lod,loq,status,limit_value,limit_unit,created_at)
      VALUES (?,?,?,?,?,?,NULL,NULL,?,?,?,?)`);
    for (const row of analytes) {
      removeCanonicalAnalyte.run(batchId, row.groupName, row.analyteName);
      insert.run(`ca-${randomUUID()}`, batchId, row.groupName, row.analyteName, row.value, row.unit,
        row.status ?? null, row.limitValue ?? null, row.limitUnit ?? null, now);
    }

    db.exec('COMMIT');
    return {
      verifiedBatch: officialCoaVerified,
      evidenceStatus: officialCoaVerified ? 'verified' as const : 'source_backed' as const,
      reason: officialCoaVerified ? 'official_coa_link' as const : embeddedLabCoa ? 'embedded_regulatory_lab_coa' as const : 'regulatory_coa_source' as const,
      productId, batchId, analyteCount: analytes.length, coaUrl: coaUrl || source.url,
      coaDocumentId, labName, overallStatus, coaSourceId,
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
