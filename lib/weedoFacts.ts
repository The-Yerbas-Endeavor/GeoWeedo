import { randomUUID } from 'crypto';
import { getDatabase } from './sqlite.ts';

export type WeedoFactsMatchLevel = 'exact_batch' | 'product_only' | 'community_unverified';

export type WeedoFactsLookup = {
  identifier: string;
  identifierType?: 'qr' | 'upc' | 'uid' | 'batch' | 'coa' | 'unknown';
};

export type WeedoFactsRecord = {
  productId: string;
  batchId: string | null;
  brandName: string | null;
  productName: string;
  productType: string | null;
  netContents: string | null;
  matchLevel: WeedoFactsMatchLevel;
  batchNumber: string | null;
  uid: string | null;
  coaNumber: string | null;
  coaUrl: string | null;
  labName: string | null;
  labLicenseNumber: string | null;
  producerName: string | null;
  producerLicenseNumber: string | null;
  testedAt: string | null;
  collectedAt: string | null;
  receivedAt: string | null;
  overallStatus: string | null;
  cannabinoids: Array<{ name: string; value: number | null; unit: string | null; lod?: number | null; loq?: number | null }>;
  terpenes: Array<{ name: string; value: number | null; unit: string | null; lod?: number | null; loq?: number | null }>;
  safetyTests: Array<{ category: string; analyte: string | null; status: string | null; value: number | null; unit: string | null; limitValue: number | null; limitUnit: string | null }>;
  source: { type: string; name: string | null; url: string | null; verified: boolean };
};

function ensureSchema() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_products (
      id TEXT PRIMARY KEY,
      brand_name TEXT,
      product_name TEXT NOT NULL,
      product_type TEXT,
      net_contents TEXT,
      normalized_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cannabis_product_identifiers (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      identifier_type TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      source TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(identifier_type, identifier_value),
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cannabis_batches (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      batch_number TEXT,
      uid TEXT,
      coa_number TEXT,
      coa_url TEXT,
      lab_name TEXT,
      lab_license_number TEXT,
      producer_name TEXT,
      producer_license_number TEXT,
      collected_at TEXT,
      received_at TEXT,
      tested_at TEXT,
      overall_status TEXT,
      source_type TEXT NOT NULL,
      source_name TEXT,
      source_url TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cannabis_batch_identifiers (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      identifier_type TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(identifier_type, identifier_value),
      FOREIGN KEY(batch_id) REFERENCES cannabis_batches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cannabis_analytes (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      group_name TEXT NOT NULL,
      analyte_name TEXT NOT NULL,
      value REAL,
      unit TEXT,
      lod REAL,
      loq REAL,
      status TEXT,
      limit_value REAL,
      limit_unit TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(batch_id) REFERENCES cannabis_batches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cannabis_coa_sources (
      id TEXT PRIMARY KEY,
      batch_id TEXT,
      source_type TEXT NOT NULL,
      source_name TEXT,
      source_url TEXT,
      external_id TEXT,
      raw_payload_json TEXT,
      parser_version TEXT,
      fetched_at TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(batch_id) REFERENCES cannabis_batches(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS cannabis_products_name_idx ON cannabis_products(normalized_name);
    CREATE INDEX IF NOT EXISTS cannabis_batches_product_idx ON cannabis_batches(product_id, tested_at DESC);
    CREATE INDEX IF NOT EXISTS cannabis_batches_batch_idx ON cannabis_batches(batch_number);
    CREATE INDEX IF NOT EXISTS cannabis_batches_uid_idx ON cannabis_batches(uid);
    CREATE INDEX IF NOT EXISTS cannabis_analytes_batch_group_idx ON cannabis_analytes(batch_id, group_name);
  `);
  return db;
}

function normalizeIdentifier(value: string) {
  return value.trim();
}

function getAnalytes(batchId: string) {
  const db = ensureSchema();
  return db.prepare(`SELECT group_name, analyte_name, value, unit, lod, loq, status, limit_value, limit_unit
                     FROM cannabis_analytes WHERE batch_id = ? ORDER BY group_name, analyte_name`).all(batchId) as any[];
}

export function lookupWeedoFacts(input: WeedoFactsLookup): WeedoFactsRecord | null {
  const identifier = normalizeIdentifier(input.identifier);
  if (!identifier) return null;
  const db = ensureSchema();

  const batchHit = db.prepare(`
    SELECT b.*, p.brand_name, p.product_name, p.product_type, p.net_contents
    FROM cannabis_batch_identifiers i
    JOIN cannabis_batches b ON b.id = i.batch_id
    JOIN cannabis_products p ON p.id = b.product_id
    WHERE i.identifier_value = ?
      AND (? IS NULL OR i.identifier_type = ?)
    ORDER BY i.verified DESC, b.verified DESC, b.tested_at DESC
    LIMIT 1
  `).get(identifier, input.identifierType ?? null, input.identifierType ?? null) as any;

  const directBatch = batchHit ?? db.prepare(`
    SELECT b.*, p.brand_name, p.product_name, p.product_type, p.net_contents
    FROM cannabis_batches b JOIN cannabis_products p ON p.id = b.product_id
    WHERE b.batch_number = ? OR b.uid = ? OR b.coa_number = ?
    ORDER BY b.verified DESC, b.tested_at DESC LIMIT 1
  `).get(identifier, identifier, identifier) as any;

  if (directBatch) {
    const analytes = getAnalytes(directBatch.id);
    return {
      productId: directBatch.product_id,
      batchId: directBatch.id,
      brandName: directBatch.brand_name,
      productName: directBatch.product_name,
      productType: directBatch.product_type,
      netContents: directBatch.net_contents,
      matchLevel: directBatch.verified ? 'exact_batch' : 'community_unverified',
      batchNumber: directBatch.batch_number,
      uid: directBatch.uid,
      coaNumber: directBatch.coa_number,
      coaUrl: directBatch.coa_url,
      labName: directBatch.lab_name,
      labLicenseNumber: directBatch.lab_license_number,
      producerName: directBatch.producer_name,
      producerLicenseNumber: directBatch.producer_license_number,
      testedAt: directBatch.tested_at,
      collectedAt: directBatch.collected_at,
      receivedAt: directBatch.received_at,
      overallStatus: directBatch.overall_status,
      cannabinoids: analytes.filter(a => a.group_name === 'cannabinoid').map(a => ({ name: a.analyte_name, value: a.value, unit: a.unit, lod: a.lod, loq: a.loq })),
      terpenes: analytes.filter(a => a.group_name === 'terpene').map(a => ({ name: a.analyte_name, value: a.value, unit: a.unit, lod: a.lod, loq: a.loq })),
      safetyTests: analytes.filter(a => !['cannabinoid', 'terpene'].includes(a.group_name)).map(a => ({ category: a.group_name, analyte: a.analyte_name, status: a.status, value: a.value, unit: a.unit, limitValue: a.limit_value, limitUnit: a.limit_unit })),
      source: { type: directBatch.source_type, name: directBatch.source_name, url: directBatch.source_url, verified: Boolean(directBatch.verified) },
    };
  }

  const productHit = db.prepare(`
    SELECT p.* FROM cannabis_product_identifiers i
    JOIN cannabis_products p ON p.id = i.product_id
    WHERE i.identifier_value = ?
      AND (? IS NULL OR i.identifier_type = ?)
    ORDER BY i.verified DESC LIMIT 1
  `).get(identifier, input.identifierType ?? null, input.identifierType ?? null) as any;

  if (!productHit) return null;
  return {
    productId: productHit.id,
    batchId: null,
    brandName: productHit.brand_name,
    productName: productHit.product_name,
    productType: productHit.product_type,
    netContents: productHit.net_contents,
    matchLevel: 'product_only',
    batchNumber: null, uid: null, coaNumber: null, coaUrl: null,
    labName: null, labLicenseNumber: null, producerName: null, producerLicenseNumber: null,
    testedAt: null, collectedAt: null, receivedAt: null, overallStatus: null,
    cannabinoids: [], terpenes: [], safetyTests: [],
    source: { type: 'product_identifier', name: null, url: null, verified: true },
  };
}

export function createWeedoFactsProduct(input: { brandName?: string | null; productName: string; productType?: string | null; netContents?: string | null }) {
  const db = ensureSchema();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO cannabis_products (id, brand_name, product_name, product_type, net_contents, normalized_name, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.brandName ?? null, input.productName, input.productType ?? null, input.netContents ?? null, `${input.brandName ?? ''} ${input.productName}`.trim().toLowerCase(), now, now);
  return id;
}

export function ensureWeedoFactsSchema() {
  ensureSchema();
}
