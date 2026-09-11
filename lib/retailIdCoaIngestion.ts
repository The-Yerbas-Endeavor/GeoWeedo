import 'server-only';

import { randomUUID } from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';
import { fetchScLabsSample, ingestScLabsSample, isScLabsSampleUrl } from './scLabs';
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

function insertIdentifier(db: any, batchId: string, type: string, value: string | null, now: string) {
  if (!value) return;
  db.prepare(`
    INSERT OR IGNORE INTO cannabis_batch_identifiers
      (id,batch_id,identifier_type,identifier_value,verified,created_at)
    VALUES (?,?,?,?,1,?)
  `).run(`cbi-${randomUUID()}`, batchId, type, value, now);
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

function upsertCoaSource(db: any, batchId: string, source: RetailId1A4Record, sourceUrl: string, now: string) {
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
          verified=1
      WHERE id=?
    `).run(sourceType, source.labName || 'Metrc Retail ID', sourceUrl, externalId, payload, now, existing.id);
    return existing.id as string;
  }
  const id = `coa-${randomUUID()}`;
  db.prepare(`
    INSERT INTO cannabis_coa_sources
      (id,batch_id,source_type,source_name,source_url,external_id,raw_payload_json,parser_version,fetched_at,verified,created_at)
    VALUES (?,?,?,?,?,?,?,'metrc-retail-id-api-v2',?,1,?)
  `).run(id, batchId, sourceType, source.labName || 'Metrc Retail ID', sourceUrl, externalId, payload, now, now);
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
  if (coaUrl) {
    const checked = await verifyCoaSource(coaUrl);
    if (checked.ok) finalSourceUrl = checked.finalUrl || coaUrl;
    else if (!embeddedLabCoa) {
      return {
        verifiedBatch: false,
        reason: 'coa_source_unreachable' as const,
        productId,
        batchId: null,
        coaUrl,
      };
    }
  }

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

  db.exec('BEGIN IMMEDIATE');
  try {
    const productEnriched = enrichVerifiedProduct(db, productId, source, now);

    if (!existing) {
      db.prepare(`
        INSERT INTO cannabis_batches (
          id,product_id,batch_number,uid,coa_number,coa_url,
          lab_name,lab_license_number,producer_name,producer_license_number,
          collected_at,received_at,tested_at,overall_status,
          source_type,source_name,source_url,verified,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?, 'lab',?,?,1,?,?)
      `).run(
        batchId,
        productId,
        clean(source.batchNumber),
        uid,
        coaNumber,
        coaUrl || source.url,
        labName,
        clean(source.labLicense),
        clean(source.facility),
        clean(source.facilityLicense),
        clean(source.testedAt),
        overallStatus,
        labName,
        finalSourceUrl,
        now,
        now,
      );
    } else {
      db.prepare(`
        UPDATE cannabis_batches SET
          product_id=COALESCE(product_id,?),
          batch_number=CASE WHEN batch_number IS NULL OR batch_number='' THEN COALESCE(?,batch_number) ELSE batch_number END,
          coa_number=CASE WHEN coa_number IS NULL OR coa_number='' THEN COALESCE(?,coa_number) ELSE coa_number END,
          coa_url=CASE WHEN coa_url IS NULL OR coa_url='' THEN COALESCE(?,coa_url) ELSE coa_url END,
          lab_name=CASE WHEN lab_name IS NULL OR lab_name='' THEN COALESCE(?,lab_name) ELSE lab_name END,
          lab_license_number=CASE WHEN lab_license_number IS NULL OR lab_license_number='' THEN COALESCE(?,lab_license_number) ELSE lab_license_number END,
          producer_name=CASE WHEN producer_name IS NULL OR producer_name='' THEN COALESCE(?,producer_name) ELSE producer_name END,
          producer_license_number=CASE WHEN producer_license_number IS NULL OR producer_license_number='' THEN COALESCE(?,producer_license_number) ELSE producer_license_number END,
          tested_at=COALESCE(?,tested_at),
          overall_status=COALESCE(?,overall_status),
          source_type='lab',
          source_name=CASE WHEN verified=1 AND source_type='lab' THEN source_name ELSE ? END,
          source_url=CASE WHEN verified=1 AND source_type='lab' THEN source_url ELSE ? END,
          verified=1,
          updated_at=?
        WHERE id=?
      `).run(
        productId,
        clean(source.batchNumber),
        coaNumber,
        coaUrl || source.url,
        labName,
        clean(source.labLicense),
        clean(source.facility),
        clean(source.facilityLicense),
        clean(source.testedAt),
        overallStatus,
        labName,
        finalSourceUrl,
        now,
        batchId,
      );
    }

    insertIdentifier(db, batchId, 'uid', uid, now);
    insertIdentifier(db, batchId, 'qr', source.url, now);
    insertIdentifier(db, batchId, 'batch', clean(source.batchNumber), now);
    insertIdentifier(db, batchId, 'coa', coaNumber, now);
    const coaSourceId = upsertCoaSource(db, batchId, source, finalSourceUrl, now);

    const analytes = sourceAnalytes(source);
    const removeCanonicalAnalyte = db.prepare(`
      DELETE FROM cannabis_analytes
      WHERE batch_id=? AND group_name=? COLLATE NOCASE AND analyte_name=? COLLATE NOCASE
    `);
    const insert = db.prepare(`
      INSERT INTO cannabis_analytes
        (id,batch_id,group_name,analyte_name,value,unit,lod,loq,status,limit_value,limit_unit,created_at)
      VALUES (?,?,?,?,?,?,NULL,NULL,?,?,?,?)
    `);

    // A verified exact-batch rescan replaces the current value for each analyte
    // present in the lab payload instead of accumulating stale values. Analytes
    // absent from the new payload are preserved, and the raw source payload
    // remains attached to the COA source for provenance.
    for (const row of analytes) {
      removeCanonicalAnalyte.run(batchId, row.groupName, row.analyteName);
      insert.run(
        `ca-${randomUUID()}`,
        batchId,
        row.groupName,
        row.analyteName,
        row.value,
        row.unit,
        row.status ?? null,
        row.limitValue ?? null,
        row.limitUnit ?? null,
        now,
      );
    }

    // Early versions of the Retail ID importer stored a generic THC summary row.
    // Once the structured payload provides Total THC, remove only the exact-value
    // legacy alias. Detailed cannabinoids such as Delta-9 THC remain untouched.
    if (Array.isArray(source.analytes) && source.analytes.length) {
      db.prepare(`
        DELETE FROM cannabis_analytes
        WHERE batch_id=?
          AND group_name='cannabinoid'
          AND analyte_name='THC' COLLATE NOCASE
          AND EXISTS (
            SELECT 1 FROM cannabis_analytes AS rich
            WHERE rich.batch_id=cannabis_analytes.batch_id
              AND rich.group_name='cannabinoid'
              AND rich.analyte_name='Total THC' COLLATE NOCASE
              AND rich.value IS cannabis_analytes.value
              AND COALESCE(rich.unit,'')=COALESCE(cannabis_analytes.unit,'')
          )
      `).run(batchId);
    }

    db.exec('COMMIT');
    return {
      verifiedBatch: true,
      reason: embeddedLabCoa ? 'embedded_regulatory_lab_coa' as const : 'authenticated_regulatory_coa' as const,
      productId,
      batchId,
      analyteCount: analytes.length,
      coaUrl: coaUrl || source.url,
      coaDocumentId,
      labName,
      overallStatus,
      productEnriched,
      coaSourceId,
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
