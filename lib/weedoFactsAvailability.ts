import { getDatabase } from './sqlite';
import { ensureWeedoMenuSchema } from './weedoMenus';
import { availabilityConfidence, ensureWeedoCoreSchema, type WeedoAvailabilityConfidence } from './weedoCore';

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

export function listWeedoFactsAvailability(productId: string, batchId?: string | null): WeedoFactsAvailabilityItem[] {
  ensureWeedoMenuSchema();
  ensureWeedoCoreSchema();
  const db = getDatabase();
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
