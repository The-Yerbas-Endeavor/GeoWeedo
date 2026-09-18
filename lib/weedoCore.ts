import 'server-only';

import { createHash } from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema, lookupWeedoFacts, type WeedoFactsRecord } from './weedoFacts';
import { ensureWeedoFactsQrSchema } from './weedoFactsQrPersistence';
import { addDispensaryMenuItem, ensureWeedoMenuSchema } from './weedoMenus';
import { normalizeProductIdentifier } from './productIdentity';

export type WeedoMatchConfidence = 'exact' | 'high' | 'possible' | 'unmatched';
export type WeedoAvailabilityConfidence = 'exact_batch' | 'same_product' | 'possible_match';
export type WeedoScanPayloadKind = 'metrc_retail_id' | 'lab_url' | 'url' | 'upc' | 'text' | 'unknown';

export type CanonicalMenuListingInput = {
  dispensaryId: string;
  externalProductName: string;
  brand?: string | null;
  category?: string | null;
  size?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  url?: string | null;
  availability?: string | null;
  observedAt?: string | null;
  sourceType?: string | null;
  externalItemId?: string | null;
  imageUrl?: string | null;
  identifiers?: Array<{ type: string; value: string }>;
  batchNumber?: string | null;
};

export type CanonicalProductMatch = {
  productId: string | null;
  batchId: string | null;
  confidence: WeedoMatchConfidence;
  score: number;
  reasons: string[];
};

type Db = ReturnType<typeof getDatabase>;

function tableExists(db: Db, table: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table));
}

function ensureColumn(db: Db, table: string, column: string, definition: string) {
  if (!tableExists(db, table)) return;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (!columns.some(row => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function runTransaction(db: Db, work: () => void) {
  db.exec('BEGIN');
  try {
    work();
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw error;
  }
}

export function normalizeIdentityText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function brandId(name: string) {
  return `brand-${createHash('sha1').update(name).digest('hex').slice(0, 20)}`;
}

export function classifyWeedoScanPayload(value: unknown): WeedoScanPayloadKind {
  const raw = String(value ?? '').trim();
  if (!raw) return 'unknown';
  if (/^\d{8,14}$/.test(raw)) return 'upc';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (host === '1a4.com' || host.endsWith('.1a4.com')) return 'metrc_retail_id';
      if (host.includes('sclabs.com') || /(?:coa|phytofacts|lab|sample|result)/i.test(raw)) return 'lab_url';
      return 'url';
    } catch {
      return 'unknown';
    }
  }
  return raw.length >= 3 ? 'text' : 'unknown';
}

export function ensureWeedoCoreSchema() {
  ensureWeedoFactsSchema();
  ensureWeedoMenuSchema();
  ensureWeedoFactsQrSchema();
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_brands (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, 'cannabis_products', 'brand_id', 'TEXT');
  ensureColumn(db, 'dispensary_menu_items', 'match_confidence', 'TEXT');
  ensureColumn(db, 'dispensary_menu_items', 'match_score', 'REAL');
  ensureColumn(db, 'dispensary_menu_items', 'match_reason', 'TEXT');
  ensureColumn(db, 'dispensary_menu_items', 'matched_at', 'TEXT');
  ensureColumn(db, 'dispensary_menu_items', 'suggested_product_id', 'TEXT');
  ensureColumn(db, 'dispensary_menu_items', 'match_review_status', 'TEXT');
  ensureColumn(db, 'dispensary_menu_items', 'match_reviewed_at', 'TEXT');
  ensureColumn(db, 'dispensary_menu_items', 'match_reviewed_by', 'TEXT');
  ensureColumn(db, 'cannabis_qr_scans', 'payload_kind', 'TEXT');
  ensureColumn(db, 'cannabis_qr_scans', 'resolution_status', 'TEXT');

  const now = new Date().toISOString();
  const brands = db.prepare(`
    SELECT DISTINCT TRIM(brand_name) AS brand_name
    FROM cannabis_products
    WHERE brand_name IS NOT NULL AND TRIM(brand_name) <> ''
  `).all() as Array<{ brand_name: string }>;

  const insertBrand = db.prepare(`
    INSERT INTO cannabis_brands (id,display_name,normalized_name,created_at,updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(normalized_name) DO UPDATE SET
      display_name=excluded.display_name,
      updated_at=excluded.updated_at
  `);
  const linkBrand = db.prepare(`UPDATE cannabis_products SET brand_id=? WHERE brand_id IS NULL AND LOWER(TRIM(brand_name))=LOWER(?)`);
  runTransaction(db, () => {
    for (const row of brands) {
      const normalized = normalizeIdentityText(row.brand_name);
      if (!normalized) continue;
      const id = brandId(normalized);
      insertBrand.run(id, row.brand_name, normalized, now, now);
      linkBrand.run(id, row.brand_name);
    }
  });

  db.exec(`
    CREATE INDEX IF NOT EXISTS cannabis_products_brand_idx ON cannabis_products(brand_id);
    CREATE INDEX IF NOT EXISTS dispensary_menu_items_match_idx ON dispensary_menu_items(match_confidence,match_score);
    CREATE INDEX IF NOT EXISTS dispensary_menu_items_review_idx ON dispensary_menu_items(match_review_status,match_confidence,active);
    CREATE INDEX IF NOT EXISTS dispensary_menu_items_suggested_product_idx ON dispensary_menu_items(suggested_product_id);
    CREATE INDEX IF NOT EXISTS cannabis_qr_scans_resolution_idx ON cannabis_qr_scans(resolution_status,last_seen_at DESC);
  `);

  return db;
}

function scoreToConfidence(score: number, exact = false): WeedoMatchConfidence {
  if (exact || score >= 98) return 'exact';
  if (score >= 80) return 'high';
  if (score >= 45) return 'possible';
  return 'unmatched';
}

export function findCanonicalProductMatch(input: {
  productName: string;
  brand?: string | null;
  size?: string | null;
  identifiers?: Array<{ type: string; value: string }>;
  batchNumber?: string | null;
}, existingDb?: Db): CanonicalProductMatch {
  const db = existingDb || ensureWeedoCoreSchema();

  for (const identifier of input.identifiers || []) {
    const normalized = normalizeProductIdentifier(identifier.type, identifier.value);
    if (!normalized) continue;
    const row = db.prepare(`
      SELECT p.id AS product_id
      FROM cannabis_product_identifiers i
      JOIN cannabis_products p ON p.id=i.product_id
      WHERE i.identifier_type=? COLLATE NOCASE
        AND (i.normalized_value=? OR i.identifier_value=? COLLATE NOCASE)
      ORDER BY i.verified DESC
      LIMIT 1
    `).get(identifier.type, normalized, identifier.value) as any;
    if (row?.product_id) {
      return { productId: String(row.product_id), batchId: null, confidence: 'exact', score: 100, reasons: [`exact ${identifier.type} identifier`] };
    }
  }

  const batchNumber = String(input.batchNumber || '').trim();
  if (batchNumber) {
    const batches = db.prepare(`
      SELECT b.id AS batch_id,b.product_id
      FROM cannabis_batches b
      WHERE b.batch_number=? COLLATE NOCASE
      ORDER BY b.verified DESC,b.tested_at DESC
      LIMIT 2
    `).all(batchNumber) as any[];
    if (batches.length === 1) {
      return { productId: String(batches[0].product_id), batchId: String(batches[0].batch_id), confidence: 'exact', score: 100, reasons: ['unique exact batch/lot identifier'] };
    }
  }

  const product = normalizeIdentityText(input.productName);
  const brand = normalizeIdentityText(input.brand);
  const size = normalizeIdentityText(input.size);
  if (!product) return { productId: null, batchId: null, confidence: 'unmatched', score: 0, reasons: ['missing product name'] };

  const candidates = db.prepare(`
    SELECT id,brand_name,product_name,net_contents,normalized_name
    FROM cannabis_products
    WHERE LOWER(product_name)=LOWER(?)
       OR normalized_name LIKE ?
    ORDER BY updated_at DESC
    LIMIT 25
  `).all(input.productName.trim(), `%${product.replace(/\s+/g, '%')}%`) as any[];

  let best: { row: any; score: number; reasons: string[] } | null = null;
  for (const row of candidates) {
    const candidateProduct = normalizeIdentityText(row.product_name);
    const candidateBrand = normalizeIdentityText(row.brand_name);
    const candidateSize = normalizeIdentityText(row.net_contents);
    let score = 0;
    const candidateReasons: string[] = [];

    if (candidateProduct === product) { score += 60; candidateReasons.push('exact normalized product name'); }
    else if (candidateProduct.includes(product) || product.includes(candidateProduct)) { score += 38; candidateReasons.push('close product name'); }

    if (brand && candidateBrand === brand) { score += 25; candidateReasons.push('exact normalized brand'); }
    else if (brand && candidateBrand && (candidateBrand.includes(brand) || brand.includes(candidateBrand))) { score += 12; candidateReasons.push('close brand'); }
    else if (brand && candidateBrand && candidateBrand !== brand) { score -= 25; candidateReasons.push('brand conflict'); }

    if (size && candidateSize === size) { score += 10; candidateReasons.push('package size match'); }
    if (score > (best?.score ?? -Infinity)) best = { row, score, reasons: candidateReasons };
  }

  if (!best) return { productId: null, batchId: null, confidence: 'unmatched', score: 0, reasons: ['no canonical product candidate'] };
  const bounded = Math.max(0, Math.min(100, best.score));
  const confidence = scoreToConfidence(bounded);
  return {
    productId: confidence === 'unmatched' ? null : String(best.row.id),
    batchId: null,
    confidence,
    score: bounded,
    reasons: best.reasons,
  };
}

export function ingestCanonicalMenuListing(input: CanonicalMenuListingInput) {
  const db = ensureWeedoCoreSchema();
  const match = findCanonicalProductMatch({
    productName: input.externalProductName,
    brand: input.brand,
    size: input.size,
    identifiers: input.identifiers,
    batchNumber: input.batchNumber,
  });

  const autoLink = Boolean(match.productId && (match.confidence === 'exact' || match.confidence === 'high'));
  const needsReview = Boolean(match.productId && match.confidence === 'possible');
  const id = addDispensaryMenuItem({
    dispensaryId: input.dispensaryId,
    productId: autoLink ? match.productId : null,
    batchId: autoLink ? match.batchId : null,
    externalItemId: input.externalItemId,
    itemName: input.externalProductName,
    brandName: input.brand,
    category: input.category,
    packageSize: input.size,
    priceCents: input.priceCents,
    currency: input.currency || 'USD',
    inventoryStatus: input.availability || 'unknown',
    sourceType: input.sourceType || 'import',
    sourceUrl: input.url,
    imageUrl: input.imageUrl,
    sourceUpdatedAt: input.observedAt,
    verified: match.confidence === 'exact',
  });

  db.prepare(`
    UPDATE dispensary_menu_items
    SET match_confidence=?,match_score=?,match_reason=?,matched_at=?,
        suggested_product_id=?,match_review_status=?,match_reviewed_at=NULL,match_reviewed_by=NULL
    WHERE id=?
  `).run(
    match.confidence,
    match.score,
    match.reasons.join('; '),
    new Date().toISOString(),
    needsReview ? match.productId : null,
    autoLink ? 'auto' : needsReview ? 'pending' : 'unmatched',
    id,
  );

  return { listingId: id, match: { ...match, productId: autoLink ? match.productId : null }, suggestedProductId: needsReview ? match.productId : null, autoLinked: autoLink, needsReview };
}

export function reconcileMenuProductMatches(limit = 200) {
  const db = ensureWeedoCoreSchema();
  const rows = db.prepare(`
    SELECT mi.id,mi.item_name,mi.brand_name,mi.package_size
    FROM dispensary_menu_items mi
    JOIN dispensary_menus m ON m.id=mi.menu_id
    JOIN dispensaries d ON d.id=m.dispensary_id
    WHERE mi.active=1 AND m.active=1 AND d.active=1
      AND mi.product_id IS NULL
      AND COALESCE(mi.match_review_status,'')=''
    ORDER BY COALESCE(mi.source_updated_at,mi.updated_at,mi.created_at) DESC
    LIMIT ?
  `).all(Math.max(1,Math.min(1000,Math.floor(limit)))) as any[];

  const now = new Date().toISOString();
  let autoLinked = 0, needsReview = 0, unmatched = 0;
  const update = db.prepare(`
    UPDATE dispensary_menu_items
    SET product_id=?,batch_id=?,suggested_product_id=?,match_confidence=?,match_score=?,
        match_reason=?,matched_at=?,match_review_status=?,match_reviewed_at=NULL,match_reviewed_by=NULL
    WHERE id=?
  `);

  runTransaction(db, () => {
    for (const row of rows) {
      const match = findCanonicalProductMatch({
        productName: String(row.item_name || ''),
        brand: row.brand_name || null,
        size: row.package_size || null,
      }, db);
      const auto = Boolean(match.productId && (match.confidence === 'exact' || match.confidence === 'high'));
      const review = Boolean(match.productId && match.confidence === 'possible');
      update.run(
        auto ? match.productId : null,
        auto ? match.batchId : null,
        review ? match.productId : null,
        match.confidence,
        match.score,
        match.reasons.join('; '),
        now,
        auto ? 'auto' : review ? 'pending' : 'unmatched',
        row.id,
      );
      if (auto) autoLinked += 1;
      else if (review) needsReview += 1;
      else unmatched += 1;
    }
  });

  return { processed: rows.length, autoLinked, needsReview, unmatched };
}

export function reviewMenuProductMatch(input: { itemId: string; decision: 'confirm' | 'reject'; adminId: string }) {
  const db = ensureWeedoCoreSchema();
  const row = db.prepare(`
    SELECT id,product_id,suggested_product_id,match_confidence,match_review_status
    FROM dispensary_menu_items WHERE id=? AND active=1 LIMIT 1
  `).get(input.itemId) as any;
  if (!row) throw new Error('Menu item was not found.');

  const suggested = row.suggested_product_id || (row.match_confidence === 'possible' ? row.product_id : null);
  const now = new Date().toISOString();
  if (input.decision === 'confirm') {
    if (!suggested) throw new Error('This menu item has no suggested product to confirm.');
    db.prepare(`
      UPDATE dispensary_menu_items
      SET product_id=?,suggested_product_id=NULL,match_confidence='high',
          match_review_status='confirmed',match_reviewed_at=?,match_reviewed_by=?,matched_at=?
      WHERE id=?
    `).run(suggested, now, input.adminId, now, input.itemId);
    return { itemId: input.itemId, productId: String(suggested), status: 'confirmed' as const };
  }

  db.prepare(`
    UPDATE dispensary_menu_items
    SET product_id=NULL,match_review_status='rejected',match_reviewed_at=?,match_reviewed_by=?
    WHERE id=?
  `).run(now, input.adminId, input.itemId);
  return { itemId: input.itemId, productId: null, status: 'rejected' as const };
}

export function availabilityConfidence(input: {
  requestedBatchId?: string | null;
  listingBatchId?: string | null;
  batchVerified?: boolean;
  matchConfidence?: string | null;
}): WeedoAvailabilityConfidence {
  if (input.requestedBatchId && input.listingBatchId === input.requestedBatchId && input.batchVerified) return 'exact_batch';
  if (input.matchConfidence === 'possible') return 'possible_match';
  return 'same_product';
}

export function refreshDerivedScanState() {
  const db = ensureWeedoCoreSchema();
  const rows = db.prepare(`SELECT id,qr_value,product_id,batch_id FROM cannabis_qr_scans`).all() as any[];
  const update = db.prepare(`UPDATE cannabis_qr_scans SET payload_kind=?,resolution_status=? WHERE id=?`);
  runTransaction(db, () => {
    for (const row of rows) {
      update.run(
        classifyWeedoScanPayload(row.qr_value),
        row.batch_id ? 'batch' : row.product_id ? 'product' : 'unresolved',
        row.id,
      );
    }
  });
}

export function listUnknownScanGroups(limit = 100) {
  refreshDerivedScanState();
  const db = getDatabase();
  return db.prepare(`
    SELECT COALESCE(payload_kind,'unknown') AS payload_kind,
           COALESCE(qr_host,'') AS qr_host,
           resolver,
           COUNT(*) AS unique_payloads,
           SUM(scan_count) AS scan_count,
           MAX(last_seen_at) AS last_seen_at,
           MIN(qr_value) AS sample_value
    FROM cannabis_qr_scans
    WHERE resolution_status='unresolved'
    GROUP BY payload_kind,qr_host,resolver
    ORDER BY scan_count DESC,last_seen_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(500, Math.floor(limit)))) as Array<{
    payload_kind: string;
    qr_host: string;
    resolver: string;
    unique_payloads: number;
    scan_count: number;
    last_seen_at: string;
    sample_value: string;
  }>;
}

export function getFactsRecordForBatchId(batchId: string): WeedoFactsRecord | null {
  const db = ensureWeedoCoreSchema();
  const row = db.prepare(`SELECT uid,coa_number,batch_number FROM cannabis_batches WHERE id=? LIMIT 1`).get(batchId) as any;
  if (!row) return null;
  if (row.uid) return lookupWeedoFacts({ identifier: String(row.uid), identifierType: 'uid' });
  if (row.coa_number) return lookupWeedoFacts({ identifier: String(row.coa_number), identifierType: 'coa' });
  if (row.batch_number) return lookupWeedoFacts({ identifier: String(row.batch_number), identifierType: 'batch' });
  return null;
}
