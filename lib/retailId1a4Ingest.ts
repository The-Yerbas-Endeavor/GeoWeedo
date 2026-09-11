import 'server-only';

import crypto from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';
import type { RetailId1A4Record } from './retailId1a4';

type IngestResult = {
  batchId: string | null;
  productId: string | null;
  created: boolean;
  preservedExisting: boolean;
  reason?: string;
};

function compatible(existing: unknown, incoming: unknown) {
  const left = String(existing ?? '').trim();
  const right = String(incoming ?? '').trim();
  return !left || !right || left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function enrichProductIdentity(product: any, source: RetailId1A4Record) {
  const db = getDatabase();
  const brandName = String(source.brandName || '').trim() || null;
  const productType = String(source.productType || '').trim() || null;
  const netContents = String(source.netContents || '').trim() || null;
  const nextBrand = product.brand_name || brandName;
  const nextType = product.product_type || productType;
  const nextContents = product.net_contents || netContents;
  const normalized = `${nextBrand || ''} ${product.product_name}`.trim().toLowerCase();

  if (
    nextBrand !== product.brand_name ||
    nextType !== product.product_type ||
    nextContents !== product.net_contents ||
    normalized !== product.normalized_name
  ) {
    db.prepare(`UPDATE cannabis_products
      SET brand_name=?, product_type=?, net_contents=?, normalized_name=?, updated_at=?
      WHERE id=?`)
      .run(nextBrand, nextType, nextContents, normalized, new Date().toISOString(), product.id);
    return db.prepare('SELECT * FROM cannabis_products WHERE id=?').get(product.id) as any;
  }
  return product;
}

function findOrCreateProduct(source: RetailId1A4Record) {
  const db = getDatabase();
  const productName = String(source.productName || '').trim();
  const brandName = String(source.brandName || '').trim() || null;
  const normalized = `${brandName || ''} ${productName}`.trim().toLowerCase();
  let product = db.prepare('SELECT * FROM cannabis_products WHERE normalized_name=? LIMIT 1').get(normalized) as any;

  if (!product) {
    const candidates = db.prepare(`SELECT * FROM cannabis_products
      WHERE product_name=? COLLATE NOCASE
      ORDER BY updated_at DESC`).all(productName) as any[];
    const compatibleCandidates = candidates.filter(row =>
      compatible(row.brand_name, brandName) &&
      compatible(row.product_type, source.productType) &&
      compatible(row.net_contents, source.netContents),
    );
    if (compatibleCandidates.length === 1) product = compatibleCandidates[0];
  }

  if (product) return enrichProductIdentity(product, source);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO cannabis_products (id,brand_name,product_name,product_type,net_contents,normalized_name,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, brandName, productName, source.productType, source.netContents, normalized, now, now);
  return db.prepare('SELECT * FROM cannabis_products WHERE id=?').get(id) as any;
}

function addSourceIdentifiers(batchId: string, source: RetailId1A4Record, now: string) {
  const db = getDatabase();
  if (source.retailId) {
    db.prepare(`INSERT OR IGNORE INTO cannabis_batch_identifiers (id,batch_id,identifier_type,identifier_value,verified,created_at)
                VALUES (?,?,?,?,1,?)`)
      .run(crypto.randomUUID(), batchId, 'uid', source.retailId, now);
  }
  db.prepare(`INSERT OR IGNORE INTO cannabis_batch_identifiers (id,batch_id,identifier_type,identifier_value,verified,created_at)
              VALUES (?,?,?,?,1,?)`)
    .run(crypto.randomUUID(), batchId, 'qr', source.url, now);
}

function recordSource(batchId: string, source: RetailId1A4Record, now: string) {
  const db = getDatabase();
  db.prepare(`INSERT INTO cannabis_coa_sources
    (id,batch_id,source_type,source_name,source_url,external_id,raw_payload_json,parser_version,fetched_at,verified,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,?)`)
    .run(
      crypto.randomUUID(),
      batchId,
      'regulatory_public',
      'Metrc Retail ID',
      source.url,
      source.retailId || source.serial,
      JSON.stringify({
        retailId: source.retailId,
        serial: source.serial,
        productName: source.productName,
        brandName: source.brandName,
        cultivar: source.cultivar,
        batchNumber: source.batchNumber,
        facility: source.facility,
        facilityLicense: source.facilityLicense,
        labName: source.labName,
        labLicense: source.labLicense,
        testedAt: source.testedAt,
        coaUrl: source.coaUrl,
        thcText: source.thcText,
        cbdText: source.cbdText,
      }),
      'retail-id-1a4-v3',
      now,
      now,
    );
}

export function ingestRetailId1A4(source: RetailId1A4Record): IngestResult {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const uid = String(source.retailId || '').trim().toUpperCase();
  if (!uid) return { batchId: null, productId: null, created: false, preservedExisting: false, reason: 'Retail ID UID was not available.' };

  const existing = db.prepare('SELECT id,product_id FROM cannabis_batches WHERE uid=? COLLATE NOCASE LIMIT 1').get(uid) as any;
  if (existing) {
    const now = new Date().toISOString();
    addSourceIdentifiers(existing.id, source, now);
    return { batchId: existing.id, productId: existing.product_id, created: false, preservedExisting: true };
  }

  if (!source.explicitProductName || !String(source.productName || '').trim()) {
    return {
      batchId: null,
      productId: null,
      created: false,
      preservedExisting: false,
      reason: 'Retail ID data was readable, but the page did not expose an explicit product/item name. GeoWeedo returned the source-backed preview without creating a canonical product.',
    };
  }

  const product = findOrCreateProduct(source);
  if (source.batchNumber) {
    const stronger = db.prepare(`SELECT id,product_id,uid FROM cannabis_batches
      WHERE product_id=? AND batch_number=? COLLATE NOCASE AND source_type='lab' AND verified=1
      ORDER BY tested_at DESC LIMIT 1`).get(product.id, source.batchNumber) as any;
    if (stronger) {
      const now = new Date().toISOString();
      if (!stronger.uid) db.prepare('UPDATE cannabis_batches SET uid=?,updated_at=? WHERE id=?').run(uid, now, stronger.id);
      addSourceIdentifiers(stronger.id, source, now);
      recordSource(stronger.id, source, now);
      return { batchId: stronger.id, productId: stronger.product_id, created: false, preservedExisting: true };
    }
  }

  const now = new Date().toISOString();
  const batchId = `metrc-${crypto.createHash('sha256').update(uid).digest('hex').slice(0, 24)}`;
  db.prepare(`INSERT INTO cannabis_batches
    (id,product_id,batch_number,uid,coa_url,lab_name,lab_license_number,producer_name,producer_license_number,tested_at,overall_status,source_type,source_name,source_url,verified,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      batchId,
      product.id,
      source.batchNumber,
      uid,
      source.coaUrl,
      source.labName,
      source.labLicense,
      source.facility,
      source.facilityLicense,
      source.testedAt,
      source.overallStatus,
      'regulatory_public',
      'Metrc Retail ID',
      source.url,
      1,
      now,
      now,
    );

  // Source-backed Retail ID data establishes package/product identity only.
  // Chemistry is promoted into cannabis_analytes exclusively by a verified lab
  // ingestion path (for example ingestRetailIdCoaEvidence) so an incomplete or
  // unverified QR can never become canonical product chemistry by itself.
  addSourceIdentifiers(batchId, source, now);
  recordSource(batchId, source, now);
  return { batchId, productId: product.id, created: true, preservedExisting: false };
}
