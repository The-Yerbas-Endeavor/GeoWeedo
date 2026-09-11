import 'server-only';

import { randomUUID } from 'crypto';
import { getDatabase } from './sqlite';
import { createWeedoFactsProduct, ensureWeedoFactsSchema } from './weedoFacts';
import type { RetailId1A4Record } from './retailId1a4';

export type PersistedQrScan = {
  id: string;
  qrValue: string;
  resolver: string;
  productId: string | null;
  batchId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  scanCount: number;
};

function ensureSchema() {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_qr_scans (
      id TEXT PRIMARY KEY,
      qr_value TEXT NOT NULL UNIQUE,
      qr_host TEXT,
      resolver TEXT NOT NULL DEFAULT 'generic_qr',
      product_id TEXT,
      batch_id TEXT,
      source_url TEXT,
      external_identifier TEXT,
      title TEXT,
      brand_name TEXT,
      product_name TEXT,
      product_type TEXT,
      producer_name TEXT,
      producer_license_number TEXT,
      lab_name TEXT,
      lab_license_number TEXT,
      tested_at TEXT,
      coa_url TEXT,
      resolved_payload_json TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      scan_count INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE SET NULL,
      FOREIGN KEY(batch_id) REFERENCES cannabis_batches(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS cannabis_qr_scans_product_idx ON cannabis_qr_scans(product_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS cannabis_qr_scans_external_idx ON cannabis_qr_scans(external_identifier);
    CREATE INDEX IF NOT EXISTS cannabis_qr_scans_resolver_idx ON cannabis_qr_scans(resolver, last_seen_at DESC);
  `);
  return db;
}

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function qrHost(value: string) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return null; }
}

function normalizeProductName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findOrCreateRetailProduct(source: RetailId1A4Record) {
  const db = ensureSchema();
  const retailId = clean(source.retailId);

  if (retailId) {
    const linked = db.prepare(`
      SELECT p.id
      FROM cannabis_product_identifiers i
      JOIN cannabis_products p ON p.id=i.product_id
      WHERE i.identifier_type='uid' AND i.identifier_value=?
      LIMIT 1
    `).get(retailId) as any;
    if (linked?.id) return String(linked.id);

    const batchLinked = db.prepare(`
      SELECT product_id
      FROM cannabis_batches
      WHERE uid=?
      ORDER BY verified DESC, updated_at DESC
      LIMIT 1
    `).get(retailId) as any;
    if (batchLinked?.product_id) return String(batchLinked.product_id);
  }

  const rawName = clean(source.title) || clean(source.cultivar);
  if (!rawName || /^(?:metrc\s+)?retail\s*id(?:\s+product)?$/i.test(rawName)) return null;
  const productName = rawName.slice(0, 240);
  const normalized = normalizeProductName(productName);
  if (!normalized) return null;

  const existing = db.prepare(`
    SELECT id
    FROM cannabis_products
    WHERE LOWER(TRIM(COALESCE(normalized_name,'')))=?
       OR LOWER(TRIM(product_name))=?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(normalized, productName.toLowerCase()) as any;
  const productId = existing?.id
    ? String(existing.id)
    : createWeedoFactsProduct({ productName });

  if (retailId) {
    const now = new Date().toISOString();
    const existingIdentifier = db.prepare(`
      SELECT id,product_id
      FROM cannabis_product_identifiers
      WHERE identifier_type='uid' AND identifier_value=?
      LIMIT 1
    `).get(retailId) as any;
    if (!existingIdentifier) {
      db.prepare(`
        INSERT INTO cannabis_product_identifiers
          (id,product_id,identifier_type,identifier_value,source,verified,created_at)
        VALUES (?,?,?,?,?,?,?)
      `).run(`pid-${randomUUID()}`, productId, 'uid', retailId, 'Metrc Retail ID', 1, now);
    }
  }

  return productId;
}

export function persistQrScan(input: {
  qrValue: string;
  resolver: string;
  productId?: string | null;
  batchId?: string | null;
  sourceUrl?: string | null;
  externalIdentifier?: string | null;
  title?: string | null;
  brandName?: string | null;
  productName?: string | null;
  productType?: string | null;
  producerName?: string | null;
  producerLicenseNumber?: string | null;
  labName?: string | null;
  labLicenseNumber?: string | null;
  testedAt?: string | null;
  coaUrl?: string | null;
  resolvedPayload?: unknown;
  countScan?: boolean;
}): PersistedQrScan {
  const db = ensureSchema();
  const qrValue = String(input.qrValue || '').trim();
  if (!qrValue) throw new Error('QR value is required for persistence.');
  const now = new Date().toISOString();
  const payload = input.resolvedPayload === undefined ? null : JSON.stringify(input.resolvedPayload);
  const existing = db.prepare('SELECT id FROM cannabis_qr_scans WHERE qr_value=? LIMIT 1').get(qrValue) as any;
  const countScan = input.countScan !== false;

  if (existing?.id) {
    db.prepare(`
      UPDATE cannabis_qr_scans SET
        qr_host=COALESCE(?,qr_host),
        resolver=?,
        product_id=COALESCE(?,product_id),
        batch_id=COALESCE(?,batch_id),
        source_url=COALESCE(?,source_url),
        external_identifier=COALESCE(?,external_identifier),
        title=COALESCE(?,title),
        brand_name=COALESCE(?,brand_name),
        product_name=COALESCE(?,product_name),
        product_type=COALESCE(?,product_type),
        producer_name=COALESCE(?,producer_name),
        producer_license_number=COALESCE(?,producer_license_number),
        lab_name=COALESCE(?,lab_name),
        lab_license_number=COALESCE(?,lab_license_number),
        tested_at=COALESCE(?,tested_at),
        coa_url=COALESCE(?,coa_url),
        resolved_payload_json=COALESCE(?,resolved_payload_json),
        last_seen_at=CASE WHEN ?=1 THEN ? ELSE last_seen_at END,
        scan_count=scan_count+?
      WHERE id=?
    `).run(
      qrHost(qrValue), input.resolver,
      input.productId || null, input.batchId || null, input.sourceUrl || null,
      input.externalIdentifier || null, input.title || null, input.brandName || null,
      input.productName || null, input.productType || null,
      input.producerName || null, input.producerLicenseNumber || null,
      input.labName || null, input.labLicenseNumber || null,
      input.testedAt || null, input.coaUrl || null, payload,
      countScan ? 1 : 0, now, countScan ? 1 : 0, existing.id,
    );
  } else {
    const id = `qr-${randomUUID()}`;
    db.prepare(`
      INSERT INTO cannabis_qr_scans (
        id,qr_value,qr_host,resolver,product_id,batch_id,source_url,external_identifier,
        title,brand_name,product_name,product_type,producer_name,producer_license_number,
        lab_name,lab_license_number,tested_at,coa_url,resolved_payload_json,
        first_seen_at,last_seen_at,scan_count
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
    `).run(
      id, qrValue, qrHost(qrValue), input.resolver,
      input.productId || null, input.batchId || null, input.sourceUrl || null,
      input.externalIdentifier || null, input.title || null, input.brandName || null,
      input.productName || null, input.productType || null,
      input.producerName || null, input.producerLicenseNumber || null,
      input.labName || null, input.labLicenseNumber || null,
      input.testedAt || null, input.coaUrl || null, payload,
      now, now,
    );
  }

  const row = db.prepare(`
    SELECT id,qr_value,resolver,product_id,batch_id,first_seen_at,last_seen_at,scan_count
    FROM cannabis_qr_scans WHERE qr_value=? LIMIT 1
  `).get(qrValue) as any;
  return {
    id: String(row.id),
    qrValue: String(row.qr_value),
    resolver: String(row.resolver),
    productId: row.product_id ? String(row.product_id) : null,
    batchId: row.batch_id ? String(row.batch_id) : null,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    scanCount: Number(row.scan_count || 1),
  };
}

export function persistRetailId1A4Scan(qrValue: string, source: RetailId1A4Record, linked?: { productId?: string | null; batchId?: string | null }, countScan = true) {
  const productId = linked?.productId || findOrCreateRetailProduct(source);
  return persistQrScan({
    qrValue,
    resolver: 'metrc_retail_id',
    productId,
    batchId: linked?.batchId || null,
    sourceUrl: source.url,
    externalIdentifier: source.retailId,
    title: source.title,
    productName: source.title || source.cultivar,
    producerName: source.facility,
    producerLicenseNumber: source.facilityLicense,
    labName: source.labName,
    labLicenseNumber: source.labLicense,
    testedAt: source.testedAt,
    coaUrl: source.coaUrl,
    resolvedPayload: source,
    countScan,
  });
}
