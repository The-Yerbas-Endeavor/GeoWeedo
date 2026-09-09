import { getDatabase } from './sqlite.ts';
import { ensureWeedoFactsSchema, type WeedoFactsRecord } from './weedoFacts.ts';

export type WeedoFactsListingSummary = {
  productId: string;
  batchId: string;
  brandName: string | null;
  productName: string;
  productType: string | null;
  netContents: string | null;
  batchNumber: string | null;
  coaNumber: string | null;
  labName: string | null;
  producerName: string | null;
  testedAt: string | null;
  overallStatus: string | null;
  analyteCount: number;
};

function analytesForBatch(batchId: string) {
  const db = getDatabase();
  return db.prepare(`
    SELECT group_name, analyte_name, value, unit, lod, loq, status, limit_value, limit_unit
    FROM cannabis_analytes
    WHERE batch_id = ?
    ORDER BY group_name, analyte_name
  `).all(batchId) as any[];
}

function productOnly(product: any): WeedoFactsRecord {
  return {
    productId: product.id,
    batchId: null,
    brandName: product.brand_name,
    productName: product.product_name,
    productType: product.product_type,
    netContents: product.net_contents,
    matchLevel: 'product_only',
    batchNumber: null,
    uid: null,
    coaNumber: null,
    coaUrl: null,
    labName: null,
    labLicenseNumber: null,
    producerName: null,
    producerLicenseNumber: null,
    testedAt: null,
    collectedAt: null,
    receivedAt: null,
    overallStatus: null,
    cannabinoids: [],
    terpenes: [],
    safetyTests: [],
    source: { type: 'product_listing', name: null, url: null, verified: false },
  };
}

function recordFromBatch(product: any, batch: any): WeedoFactsRecord {
  const analytes = analytesForBatch(batch.id);
  return {
    productId: product.id,
    batchId: batch.id,
    brandName: product.brand_name,
    productName: product.product_name,
    productType: product.product_type,
    netContents: product.net_contents,
    matchLevel: batch.verified ? 'exact_batch' : 'community_unverified',
    batchNumber: batch.batch_number,
    uid: batch.uid,
    coaNumber: batch.coa_number,
    coaUrl: batch.coa_url,
    labName: batch.lab_name,
    labLicenseNumber: batch.lab_license_number,
    producerName: batch.producer_name,
    producerLicenseNumber: batch.producer_license_number,
    testedAt: batch.tested_at,
    collectedAt: batch.collected_at,
    receivedAt: batch.received_at,
    overallStatus: batch.overall_status,
    cannabinoids: analytes
      .filter(a => a.group_name === 'cannabinoid')
      .map(a => ({ name: a.analyte_name, value: a.value, unit: a.unit, lod: a.lod, loq: a.loq })),
    terpenes: analytes
      .filter(a => a.group_name === 'terpene')
      .map(a => ({ name: a.analyte_name, value: a.value, unit: a.unit, lod: a.lod, loq: a.loq })),
    safetyTests: analytes
      .filter(a => !['cannabinoid', 'terpene'].includes(a.group_name))
      .map(a => ({
        category: a.group_name,
        analyte: a.analyte_name,
        status: a.status,
        value: a.value,
        unit: a.unit,
        limitValue: a.limit_value,
        limitUnit: a.limit_unit,
      })),
    source: {
      type: batch.source_type,
      name: batch.source_name,
      url: batch.source_url || batch.coa_url,
      verified: Boolean(batch.verified),
    },
  };
}

export function listWeedoFactsListings(): WeedoFactsListingSummary[] {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      p.id AS product_id,
      p.brand_name,
      p.product_name,
      p.product_type,
      p.net_contents,
      b.id AS batch_id,
      b.batch_number,
      b.coa_number,
      b.lab_name,
      b.producer_name,
      b.tested_at,
      b.overall_status,
      COUNT(a.id) AS analyte_count
    FROM cannabis_batches b
    JOIN cannabis_products p ON p.id = b.product_id
    LEFT JOIN cannabis_analytes a ON a.batch_id = b.id
    WHERE b.verified = 1
    GROUP BY b.id
    ORDER BY COALESCE(b.tested_at, b.updated_at, b.created_at) DESC,
             p.product_name COLLATE NOCASE,
             p.brand_name COLLATE NOCASE
  `).all() as any[];

  return rows.map(row => ({
    productId: row.product_id,
    batchId: row.batch_id,
    brandName: row.brand_name,
    productName: row.product_name,
    productType: row.product_type,
    netContents: row.net_contents,
    batchNumber: row.batch_number,
    coaNumber: row.coa_number,
    labName: row.lab_name,
    producerName: row.producer_name,
    testedAt: row.tested_at,
    overallStatus: row.overall_status,
    analyteCount: Number(row.analyte_count || 0),
  }));
}

/**
 * Resolve the permanent GeoWeedo product listing.
 *
 * A product page defaults to the newest verified lab batch. A specific batch can
 * be selected only when it belongs to the product and is verified. This keeps a
 * permanent product listing separate from the stronger claim that a shopper's
 * physical package is the exact tested batch.
 */
export function getWeedoFactsProductListing(productId: string, requestedBatchId?: string | null): WeedoFactsRecord | null {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const product = db.prepare(`
    SELECT id, brand_name, product_name, product_type, net_contents
    FROM cannabis_products
    WHERE id = ?
    LIMIT 1
  `).get(productId) as any;
  if (!product) return null;

  let batch: any = null;
  if (requestedBatchId) {
    batch = db.prepare(`
      SELECT *
      FROM cannabis_batches
      WHERE id = ? AND product_id = ? AND verified = 1
      LIMIT 1
    `).get(requestedBatchId, productId) as any;
  }

  if (!batch) {
    batch = db.prepare(`
      SELECT *
      FROM cannabis_batches
      WHERE product_id = ? AND verified = 1
      ORDER BY COALESCE(tested_at, updated_at, created_at) DESC, created_at DESC
      LIMIT 1
    `).get(productId) as any;
  }

  return batch ? recordFromBatch(product, batch) : productOnly(product);
}
