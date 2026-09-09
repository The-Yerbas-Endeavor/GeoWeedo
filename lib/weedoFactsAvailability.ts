import { getDatabase } from './sqlite';
import { ensureWeedoMenuSchema } from './weedoMenus';

export type WeedoFactsAvailabilityItem = {
  menuItemId: string;
  productId: string;
  batchId: string | null;
  exactBatch: boolean;
  dispensary: {
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    country: string | null;
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
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT mi.id AS menu_item_id, mi.product_id, mi.batch_id, mi.item_name, mi.brand_name,
           mi.category, mi.variant, mi.package_size, mi.price_cents, mi.currency,
           mi.inventory_status, mi.verified AS item_verified, mi.source_url, mi.source_updated_at,
           d.id AS dispensary_id, d.name AS dispensary_name, d.city, d.region, d.country,
           b.batch_number, b.uid, b.verified AS batch_verified
      FROM dispensary_menu_items mi
      JOIN dispensary_menus m ON m.id = mi.menu_id
      JOIN dispensaries d ON d.id = m.dispensary_id
      LEFT JOIN cannabis_batches b ON b.id = mi.batch_id
     WHERE mi.product_id = ?
       AND mi.active = 1
       AND m.active = 1
       AND d.active = 1
     ORDER BY CASE WHEN ? IS NOT NULL AND mi.batch_id = ? THEN 0 ELSE 1 END,
              mi.verified DESC,
              d.name COLLATE NOCASE,
              mi.item_name COLLATE NOCASE
  `).all(productId, batchId || null, batchId || null) as any[];

  return rows.map((row) => ({
    menuItemId: row.menu_item_id,
    productId: row.product_id,
    batchId: row.batch_id,
    exactBatch: Boolean(batchId && row.batch_id === batchId && row.batch_verified),
    dispensary: {
      id: row.dispensary_id,
      name: row.dispensary_name,
      city: row.city || null,
      region: row.region || null,
      country: row.country || null,
    },
    itemName: row.item_name,
    brandName: row.brand_name || null,
    category: row.category || null,
    variant: row.variant || null,
    packageSize: row.package_size || null,
    priceCents: Number.isFinite(Number(row.price_cents)) ? Number(row.price_cents) : null,
    currency: row.currency || 'USD',
    inventoryStatus: row.inventory_status || 'unknown',
    verified: Boolean(row.item_verified),
    sourceUrl: row.source_url || null,
    sourceUpdatedAt: row.source_updated_at || null,
    batchNumber: row.batch_number || null,
    uid: row.uid || null,
    batchVerified: Boolean(row.batch_verified),
  }));
}
