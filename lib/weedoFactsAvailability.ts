import { getDatabase } from './sqlite';
import { ensureWeedoMenuSchema } from './weedoMenus';
import { availabilityConfidence, ensureWeedoCoreSchema, findCanonicalProductMatch, type WeedoAvailabilityConfidence } from './weedoCore';

export type WeedoFactsAvailabilityItem = {
  menuItemId: string;
  productId: string;
  batchId: string | null;
  exactBatch: boolean;
  matchConfidence: string | null;
  availabilityConfidence: WeedoAvailabilityConfidence;
  dispensary: {
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  itemName: string;
  brandName: string | null;
  category: string | null;
  variant: string | null;
  packageSize: string | null;
  priceCents: number | null;
  currency: string;
  inventoryStatus: string;
  verified: boolean;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  batchNumber: string | null;
  uid: string | null;
  batchVerified: boolean;
};

function refreshStrongMenuLinksForProduct(productId: string) {
  const db = getDatabase();
  const product = db.prepare(`
    SELECT id,brand_name,product_name,net_contents
    FROM cannabis_products
    WHERE id=?
    LIMIT 1
  `).get(productId) as any;
  if (!product?.id || !String(product.product_name || '').trim()) return 0;

  const productName = String(product.product_name || '').trim();
  const brandName = String(product.brand_name || '').trim();

  const candidates = db.prepare(`
    SELECT mi.id,mi.item_name,mi.brand_name,mi.package_size
    FROM dispensary_menu_items mi
    JOIN dispensary_menus m ON m.id=mi.menu_id
    JOIN dispensaries d ON d.id=m.dispensary_id
    WHERE mi.active=1
      AND m.active=1
      AND d.active=1
      AND mi.product_id IS NULL
      AND COALESCE(mi.match_review_status,'') <> 'rejected'
      AND (
        LOWER(mi.item_name)=LOWER(?)
        OR LOWER(mi.item_name) LIKE '%' || LOWER(?) || '%'
        OR LOWER(?) LIKE '%' || LOWER(mi.item_name) || '%'
        OR (? <> '' AND LOWER(COALESCE(mi.brand_name,''))=LOWER(?))
      )
    ORDER BY COALESCE(mi.source_updated_at,mi.updated_at,mi.created_at) DESC
    LIMIT 1000
  `).all(productName, productName, productName, brandName, brandName) as any[];

  if (!candidates.length) return 0;

  const now = new Date().toISOString();
  const update = db.prepare(`
    UPDATE dispensary_menu_items
    SET product_id=?,
        batch_id=COALESCE(?,batch_id),
        suggested_product_id=NULL,
        match_confidence=?,
        match_score=?,
        match_reason=?,
        matched_at=?,
        match_review_status='auto',
        match_reviewed_at=NULL,
        match_reviewed_by=NULL,
        updated_at=?
    WHERE id=?
      AND product_id IS NULL
      AND COALESCE(match_review_status,'') <> 'rejected'
  `);

  let linked = 0;
  for (const row of candidates) {
    const match = findCanonicalProductMatch({
      productName: String(row.item_name || ''),
      brand: row.brand_name || null,
      size: row.package_size || null,
    }, db);
    if (match.productId !== productId || !['exact','high'].includes(match.confidence)) continue;
    const result = update.run(
      productId,
      match.batchId || null,
      match.confidence,
      match.score,
      match.reasons.join('; '),
      now,
      now,
      row.id,
    );
    linked += Number(result.changes || 0);
  }

  return linked;
}

export function listWeedoFactsAvailability(productId: string, batchId?: string | null): WeedoFactsAvailabilityItem[] {
  ensureWeedoMenuSchema();
  ensureWeedoCoreSchema();
  const db = getDatabase();
  refreshStrongMenuLinksForProduct(productId);
  const rows = db.prepare(`
    SELECT mi.id AS menu_item_id, mi.product_id, mi.batch_id, mi.item_name, mi.brand_name,
           mi.category, mi.variant, mi.package_size, mi.price_cents, mi.currency,
           mi.inventory_status, mi.verified AS item_verified, mi.source_url, mi.source_updated_at,
           mi.match_confidence,mi.match_review_status,
           d.id AS dispensary_id, d.name AS dispensary_name, d.city, d.region, d.country,
           d.latitude, d.longitude,
           b.batch_number, b.uid, b.verified AS batch_verified
      FROM dispensary_menu_items mi
      JOIN dispensary_menus m ON m.id = mi.menu_id
      JOIN dispensaries d ON d.id = m.dispensary_id
      LEFT JOIN cannabis_batches b ON b.id = mi.batch_id
     WHERE mi.product_id = ?
       AND mi.active = 1
       AND m.active = 1
       AND d.active = 1
       AND NOT (
         mi.match_confidence='possible'
         AND COALESCE(mi.match_review_status,'pending') <> 'confirmed'
       )
     ORDER BY CASE WHEN ? IS NOT NULL AND mi.batch_id = ? AND b.verified=1 THEN 0
                   WHEN COALESCE(mi.match_confidence,'high') IN ('exact','high') THEN 1
                   ELSE 2 END,
              mi.verified DESC,
              d.name COLLATE NOCASE,
              mi.item_name COLLATE NOCASE
  `).all(productId, batchId || null, batchId || null) as any[];

  return rows.map((row) => {
    const confidence = availabilityConfidence({
      requestedBatchId: batchId || null,
      listingBatchId: row.batch_id || null,
      batchVerified: Boolean(row.batch_verified),
      matchConfidence: row.match_confidence || null,
    });
    const latitude = row.latitude === null || row.latitude === undefined || row.latitude === '' ? null : Number(row.latitude);
    const longitude = row.longitude === null || row.longitude === undefined || row.longitude === '' ? null : Number(row.longitude);
    const priceCents = row.price_cents === null || row.price_cents === undefined || row.price_cents === '' ? null : Number(row.price_cents);
    return {
      menuItemId: row.menu_item_id,
      productId: row.product_id,
      batchId: row.batch_id,
      exactBatch: confidence === 'exact_batch',
      matchConfidence: row.match_confidence || null,
      availabilityConfidence: confidence,
      dispensary: {
        id: row.dispensary_id,
        name: row.dispensary_name,
        city: row.city || null,
        region: row.region || null,
        country: row.country || null,
        latitude: latitude !== null && Number.isFinite(latitude) ? latitude : null,
        longitude: longitude !== null && Number.isFinite(longitude) ? longitude : null,
      },
      itemName: row.item_name,
      brandName: row.brand_name || null,
      category: row.category || null,
      variant: row.variant || null,
      packageSize: row.package_size || null,
      priceCents: priceCents !== null && Number.isFinite(priceCents) ? priceCents : null,
      currency: row.currency || 'USD',
      inventoryStatus: row.inventory_status || 'unknown',
      verified: Boolean(row.item_verified),
      sourceUrl: row.source_url || null,
      sourceUpdatedAt: row.source_updated_at || null,
      batchNumber: row.batch_number || null,
      uid: row.uid || null,
      batchVerified: Boolean(row.batch_verified),
    };
  });
}
