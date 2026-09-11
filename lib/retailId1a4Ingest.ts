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

function potency(value: string | null, label: string) {
  if (!value) return null;
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*(%|MG|G|UG|MCG)?(?:\s+PER\s+(PACKAGE|SERVING|UNIT))?/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const rawUnit = String(match[2] || '').toLowerCase();
  const per = String(match[3] || '').toLowerCase();
  return { name: label, value: number, unit: rawUnit ? `${rawUnit}${per ? `/${per}` : ''}` : null };
}

function findOrCreateProduct(source: RetailId1A4Record) {
  const db = getDatabase();
  const productName = String(source.productName || '').trim();
  const brandName = String(source.brandName || '').trim() || null;
  const normalized = `${brandName || ''} ${productName}`.trim().toLowerCase();
  let product = db.prepare('SELECT * FROM cannabis_products WHERE normalized_name=? LIMIT 1').get(normalized) as any;
  if (!product && !brandName) {
    product = db.prepare(`SELECT * FROM cannabis_products WHERE brand_name IS NULL AND product_name=? COLLATE NOCASE LIMIT 1`).get(productName) as any;
  }
  if (product) return product;

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
  getDatabase().prepare(`INSERT INTO cannabis_coa_sources
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
      'retail-id-1a4-v2',
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

  const insertAnalyte = db.prepare(`INSERT INTO cannabis_analytes
    (id,batch_id,group_name,analyte_name,value,unit,lod,loq,status,limit_value,limit_unit,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of [potency(source.thcText, 'THC'), potency(source.cbdText, 'CBD')].filter(Boolean) as Array<{name:string;value:number;unit:string|null}>) {
    insertAnalyte.run(crypto.randomUUID(), batchId, 'cannabinoid', row.name, row.value, row.unit, null, null, null, null, null, now);
  }

  addSourceIdentifiers(batchId, source, now);
  recordSource(batchId, source, now);
  return { batchId, productId: product.id, created: true, preservedExisting: false };
}
