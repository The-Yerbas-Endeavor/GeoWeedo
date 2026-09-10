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
  producerLicenseNumber: string | null;
  testedAt: string | null;
  overallStatus: string | null;
  sourceType: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  analyteCount: number;
};

export type ProductChemistryCatalogFilters = {
  q?: string | null;
  brand?: string | null;
  business?: string | null;
  type?: string | null;
  page?: number | null;
  pageSize?: number | null;
};

export type ProductChemistryCatalog = {
  listings: WeedoFactsListingSummary[];
  totalListings: number;
  matchingListings: number;
  productCount: number;
  brandCount: number;
  businessCount: number;
  hasCannlytics: boolean;
  page: number;
  pageSize: number;
  pageCount: number;
  brands: string[];
  businesses: string[];
  productTypes: string[];
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

function mapListing(row: any): WeedoFactsListingSummary {
  return {
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
    producerLicenseNumber: row.producer_license_number,
    testedAt: row.tested_at,
    overallStatus: row.overall_status,
    sourceType: row.source_type,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    analyteCount: Number(row.analyte_count || 0),
  };
}

const LISTING_SELECT = `
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
    b.producer_license_number,
    b.tested_at,
    b.overall_status,
    b.source_type,
    b.source_name,
    b.source_url,
    (SELECT COUNT(*) FROM cannabis_analytes a WHERE a.batch_id = b.id) AS analyte_count
  FROM cannabis_batches b
  JOIN cannabis_products p ON p.id = b.product_id
`;

export function listWeedoFactsListings(): WeedoFactsListingSummary[] {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const rows = db.prepare(`${LISTING_SELECT}
    WHERE b.verified = 1
    ORDER BY COALESCE(b.tested_at, b.updated_at, b.created_at) DESC,
             p.product_name COLLATE NOCASE,
             p.brand_name COLLATE NOCASE
  `).all() as any[];
  return rows.map(mapListing);
}

function normalizedSearch(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function distinctValues(db: any, column: string) {
  const allowed = new Set(['p.brand_name', 'b.producer_name', 'p.product_type']);
  if (!allowed.has(column)) return [];
  const rows = db.prepare(`
    SELECT DISTINCT ${column} AS value
    FROM cannabis_batches b
    JOIN cannabis_products p ON p.id = b.product_id
    WHERE b.verified = 1 AND ${column} IS NOT NULL AND TRIM(${column}) <> ''
    ORDER BY value COLLATE NOCASE
  `).all() as any[];
  return rows.map(row => String(row.value));
}

export function getProductChemistryCatalog(filters: ProductChemistryCatalogFilters = {}): ProductChemistryCatalog {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const q = normalizedSearch(filters.q);
  const brand = String(filters.brand || '').trim();
  const business = String(filters.business || '').trim();
  const type = String(filters.type || '').trim();
  const pageSize = Math.max(10, Math.min(100, Math.floor(Number(filters.pageSize || 50)) || 50));

  const conditions = ['b.verified = 1'];
  const params: Array<string | number> = [];
  if (brand) { conditions.push('p.brand_name = ?'); params.push(brand); }
  if (business) { conditions.push('b.producer_name = ?'); params.push(business); }
  if (type) { conditions.push('p.product_type = ?'); params.push(type); }

  const searchExpression = `LOWER(
    COALESCE(p.product_name,'') || ' ' || COALESCE(p.brand_name,'') || ' ' ||
    COALESCE(b.producer_name,'') || ' ' || COALESCE(b.producer_license_number,'') || ' ' ||
    COALESCE(p.product_type,'') || ' ' || COALESCE(b.batch_number,'') || ' ' ||
    COALESCE(b.coa_number,'') || ' ' || COALESCE(b.lab_name,'') || ' ' || COALESCE(b.source_name,'')
  )`;
  for (const token of q.split(/\s+/).filter(Boolean)) {
    conditions.push(`${searchExpression} LIKE ?`);
    params.push(`%${token}%`);
  }
  const where = conditions.join(' AND ');

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total_listings,
      COUNT(DISTINCT b.product_id) AS product_count,
      COUNT(DISTINCT CASE WHEN p.brand_name IS NOT NULL AND TRIM(p.brand_name) <> '' THEN p.brand_name END) AS brand_count,
      COUNT(DISTINCT CASE WHEN b.producer_name IS NOT NULL AND TRIM(b.producer_name) <> '' THEN b.producer_name END) AS business_count,
      MAX(CASE WHEN b.source_name = 'Cannlytics' THEN 1 ELSE 0 END) AS has_cannlytics
    FROM cannabis_batches b
    JOIN cannabis_products p ON p.id = b.product_id
    WHERE b.verified = 1
  `).get() as any;

  const matched = db.prepare(`
    SELECT COUNT(*) AS count
    FROM cannabis_batches b
    JOIN cannabis_products p ON p.id = b.product_id
    WHERE ${where}
  `).get(...params) as any;
  const matchingListings = Number(matched?.count || 0);
  const pageCount = Math.max(1, Math.ceil(matchingListings / pageSize));
  const requestedPage = Math.max(1, Math.floor(Number(filters.page || 1)) || 1);
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;

  const rows = db.prepare(`${LISTING_SELECT}
    WHERE ${where}
    ORDER BY COALESCE(b.tested_at, b.updated_at, b.created_at) DESC,
             p.product_name COLLATE NOCASE,
             p.brand_name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as any[];

  return {
    listings: rows.map(mapListing),
    totalListings: Number(stats?.total_listings || 0),
    matchingListings,
    productCount: Number(stats?.product_count || 0),
    brandCount: Number(stats?.brand_count || 0),
    businessCount: Number(stats?.business_count || 0),
    hasCannlytics: Boolean(stats?.has_cannlytics),
    page,
    pageSize,
    pageCount,
    brands: distinctValues(db, 'p.brand_name'),
    businesses: distinctValues(db, 'b.producer_name'),
    productTypes: distinctValues(db, 'p.product_type'),
  };
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
