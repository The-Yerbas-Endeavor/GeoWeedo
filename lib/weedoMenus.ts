import { randomUUID } from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';
import { ensureProductCategorySchema, getProductCategory, resolveProductCategory } from './productCategories';

export type MenuItemInput = {
  dispensaryId: string;
  productId?: string | null;
  batchId?: string | null;
  externalItemId?: string | null;
  itemName: string;
  brandName?: string | null;
  category?: string | null;
  categoryId?: string | null;
  categorySource?: string | null;
  variant?: string | null;
  packageSize?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  inventoryStatus?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  imageUrl?: string | null;
  sourceUpdatedAt?: string | null;
  verified?: boolean;
};

export type ScanContributionInput = {
  userId: string;
  identifierType: 'qr' | 'upc' | 'uid' | 'batch' | 'coa' | 'unknown';
  identifierValue: string;
  productId?: string | null;
  batchId?: string | null;
  dispensaryId?: string | null;
  brandName?: string | null;
  productName?: string | null;
  productType?: string | null;
  netContents?: string | null;
  batchNumber?: string | null;
  uid?: string | null;
  coaUrl?: string | null;
  sourceUrl?: string | null;
  notes?: string | null;
  menu?: {
    itemName?: string | null;
    category?: string | null;
    variant?: string | null;
    packageSize?: string | null;
    priceCents?: number | null;
    currency?: string | null;
  } | null;
};

let menuSchemaReady = false;

function ensureSchema() {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  if (menuSchemaReady) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS dispensary_menus (
      id TEXT PRIMARY KEY,
      dispensary_id TEXT NOT NULL,
      menu_name TEXT NOT NULL DEFAULT 'Menu',
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT,
      external_menu_id TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      source_updated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(dispensary_id) REFERENCES dispensaries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dispensary_menu_items (
      id TEXT PRIMARY KEY,
      menu_id TEXT NOT NULL,
      product_id TEXT,
      batch_id TEXT,
      external_item_id TEXT,
      item_name TEXT NOT NULL,
      brand_name TEXT,
      category TEXT,
      variant TEXT,
      package_size TEXT,
      price_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      inventory_status TEXT NOT NULL DEFAULT 'unknown',
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT,
      image_url TEXT,
      source_updated_at TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(menu_id) REFERENCES dispensary_menus(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE SET NULL,
      FOREIGN KEY(batch_id) REFERENCES cannabis_batches(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS cannabis_product_media (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(product_id, image_url),
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cannabis_scan_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      identifier_type TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      product_id TEXT,
      batch_id TEXT,
      match_level TEXT,
      scanned_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE SET NULL,
      FOREIGN KEY(batch_id) REFERENCES cannabis_batches(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS cannabis_product_submissions (
      id TEXT PRIMARY KEY,
      submitted_by_user_id TEXT NOT NULL,
      identifier_type TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      product_id TEXT,
      batch_id TEXT,
      dispensary_id TEXT,
      brand_name TEXT,
      product_name TEXT,
      product_type TEXT,
      net_contents TEXT,
      batch_number TEXT,
      uid TEXT,
      coa_url TEXT,
      source_url TEXT,
      notes TEXT,
      evidence_json TEXT,
      requested_menu_add INTEGER NOT NULL DEFAULT 0,
      menu_item_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by_admin_id TEXT,
      reviewed_at TEXT,
      review_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(submitted_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE SET NULL,
      FOREIGN KEY(batch_id) REFERENCES cannabis_batches(id) ON DELETE SET NULL,
      FOREIGN KEY(dispensary_id) REFERENCES dispensaries(id) ON DELETE SET NULL,
      FOREIGN KEY(reviewed_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS dispensary_menus_dispensary_idx ON dispensary_menus(dispensary_id, active, verified);
    CREATE INDEX IF NOT EXISTS dispensary_menu_items_menu_idx ON dispensary_menu_items(menu_id, active, category, brand_name);
    CREATE INDEX IF NOT EXISTS dispensary_menu_items_product_idx ON dispensary_menu_items(product_id, batch_id, active);
    CREATE INDEX IF NOT EXISTS dispensary_menu_items_external_idx ON dispensary_menu_items(menu_id, external_item_id);
    CREATE INDEX IF NOT EXISTS cannabis_product_media_product_idx ON cannabis_product_media(product_id, is_primary, updated_at DESC);
    CREATE INDEX IF NOT EXISTS cannabis_scan_history_user_idx ON cannabis_scan_history(user_id, scanned_at DESC);
    CREATE INDEX IF NOT EXISTS cannabis_product_submissions_status_idx ON cannabis_product_submissions(status, created_at);
    CREATE INDEX IF NOT EXISTS cannabis_product_submissions_identifier_idx ON cannabis_product_submissions(identifier_type, identifier_value);
  `);

  const menuItemColumns = db.prepare('PRAGMA table_info(dispensary_menu_items)').all() as any[];
  if (!menuItemColumns.some(column => column.name === 'image_url')) db.exec('ALTER TABLE dispensary_menu_items ADD COLUMN image_url TEXT');
  ensureProductCategorySchema(db, { backfill: false });
  menuSchemaReady = true;
  return db;
}

export function ensureWeedoMenuSchema() { ensureSchema(); }

export function setProductPrimaryImage(productId: string, imageUrl: string, input?: { sourceType?: string; sourceUrl?: string | null }) {
  const db = ensureSchema();
  const now = new Date().toISOString();
  db.prepare('UPDATE cannabis_product_media SET is_primary=0, updated_at=? WHERE product_id=? AND is_primary=1').run(now, productId);
  const existing = db.prepare('SELECT id FROM cannabis_product_media WHERE product_id=? AND image_url=? LIMIT 1').get(productId, imageUrl) as any;
  if (existing) {
    db.prepare('UPDATE cannabis_product_media SET source_type=?, source_url=?, is_primary=1, updated_at=? WHERE id=?').run(input?.sourceType || 'manual', input?.sourceUrl || null, now, existing.id);
    return existing.id as string;
  }
  const id = `productmedia-${randomUUID()}`;
  db.prepare('INSERT INTO cannabis_product_media (id,product_id,image_url,source_type,source_url,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)')
    .run(id, productId, imageUrl, input?.sourceType || 'manual', input?.sourceUrl || null, now, now);
  return id;
}

export function getOrCreateDispensaryMenu(dispensaryId: string, input?: { menuName?: string; sourceType?: string; sourceUrl?: string | null; externalMenuId?: string | null }) {
  const db = ensureSchema();
  const existing = db.prepare('SELECT * FROM dispensary_menus WHERE dispensary_id=? AND active=1 ORDER BY verified DESC, created_at LIMIT 1').get(dispensaryId) as any;
  if (existing) return existing;
  const id = `menu-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO dispensary_menus (id,dispensary_id,menu_name,source_type,source_url,external_menu_id,verified,active,created_at,updated_at) VALUES (?,?,?,?,?,?,0,1,?,?)')
    .run(id, dispensaryId, input?.menuName || 'Menu', input?.sourceType || 'manual', input?.sourceUrl || null, input?.externalMenuId || null, now, now);
  return db.prepare('SELECT * FROM dispensary_menus WHERE id=?').get(id) as any;
}

function canonicalCategoryForInput(db: ReturnType<typeof getDatabase>, input: MenuItemInput) {
  if (input.categoryId) {
    const category = getProductCategory(input.categoryId, db);
    if (!category) throw new Error('Product category was not found.');
    return { id: category.id, source: input.categorySource || 'manual' };
  }
  if (input.productId) {
    const product = db.prepare('SELECT category_id FROM cannabis_products WHERE id=? LIMIT 1').get(input.productId) as any;
    if (product?.category_id) return { id: String(product.category_id), source: 'product' };
  }
  const mapped = resolveProductCategory(input.category, db);
  if (mapped) return { id: mapped.id, source: input.categorySource || 'auto' };
  return { id: null, source: null };
}

export function addDispensaryMenuItem(input: MenuItemInput) {
  const db = ensureSchema();
  const menu = getOrCreateDispensaryMenu(input.dispensaryId, { sourceType: input.sourceType || 'manual', sourceUrl: input.sourceUrl || null });
  const now = new Date().toISOString();
  const canonical = canonicalCategoryForInput(db, input);
  if (input.externalItemId) {
    const existing = db.prepare('SELECT id FROM dispensary_menu_items WHERE menu_id=? AND external_item_id=? LIMIT 1').get(menu.id, input.externalItemId) as any;
    if (existing) {
      db.prepare('UPDATE dispensary_menu_items SET product_id=?,batch_id=?,item_name=?,brand_name=?,category=?,category_id=?,category_source=?,variant=?,package_size=?,price_cents=?,currency=?,inventory_status=?,source_type=?,source_url=?,image_url=?,source_updated_at=?,verified=?,active=1,updated_at=? WHERE id=?')
        .run(input.productId || null, input.batchId || null, input.itemName, input.brandName || null, input.category || null, canonical.id, canonical.source, input.variant || null, input.packageSize || null, input.priceCents ?? null, input.currency || 'USD', input.inventoryStatus || 'unknown', input.sourceType || 'manual', input.sourceUrl || null, input.imageUrl || null, input.sourceUpdatedAt || null, input.verified ? 1 : 0, now, existing.id);
      return existing.id as string;
    }
  }
  const id = `menuitem-${randomUUID()}`;
  db.prepare(`INSERT INTO dispensary_menu_items (id,menu_id,product_id,batch_id,external_item_id,item_name,brand_name,category,category_id,category_source,variant,package_size,price_cents,currency,inventory_status,source_type,source_url,image_url,source_updated_at,verified,active,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`)
    .run(id, menu.id, input.productId || null, input.batchId || null, input.externalItemId || null, input.itemName, input.brandName || null, input.category || null, canonical.id, canonical.source, input.variant || null, input.packageSize || null, input.priceCents ?? null, input.currency || 'USD', input.inventoryStatus || 'unknown', input.sourceType || 'manual', input.sourceUrl || null, input.imageUrl || null, input.sourceUpdatedAt || null, input.verified ? 1 : 0, now, now);
  return id;
}

export function listDispensaryMenu(dispensaryId: string) {
  const db = ensureSchema();
  const items = db.prepare(`
    SELECT mi.*,m.dispensary_id,m.menu_name,
           COALESCE(mi.image_url,(SELECT pm.image_url FROM cannabis_product_media pm WHERE pm.product_id=mi.product_id ORDER BY pm.is_primary DESC,pm.updated_at DESC LIMIT 1)) AS display_image_url,
           p.product_name AS linked_product_name,p.brand_name AS linked_brand_name,p.product_type AS linked_product_type,
           mi.category AS source_category,
           COALESCE(pc.name,mc.name,mi.category) AS display_category,
           COALESCE(pc.id,mc.id) AS canonical_category_id,
           COALESCE(pc.slug,mc.slug,'other') AS canonical_category_slug,
           COALESCE(pc.name,mc.name,mi.category,'Other') AS canonical_category_name,
           CASE WHEN pc.id IS NOT NULL THEN 'product' ELSE COALESCE(mi.category_source,'menu') END AS canonical_category_source,
           b.batch_number AS linked_batch_number,b.uid AS linked_uid,b.overall_status AS linked_batch_status,b.verified AS linked_batch_verified
      FROM dispensary_menus m
      JOIN dispensary_menu_items mi ON mi.menu_id=m.id
      LEFT JOIN cannabis_products p ON p.id=mi.product_id
      LEFT JOIN cannabis_product_categories mc ON mc.id=mi.category_id
      LEFT JOIN cannabis_product_categories pc ON pc.id=p.category_id
      LEFT JOIN cannabis_batches b ON b.id=mi.batch_id
     WHERE m.dispensary_id=? AND m.active=1 AND mi.active=1
     ORDER BY COALESCE(pc.sort_order,mc.sort_order,999),COALESCE(mi.brand_name,p.brand_name,''),mi.item_name
  `).all(dispensaryId) as any[];

  const observations = db.prepare(`
    SELECT o.id,
           o.product_id,
           o.batch_id,
           p.product_name AS item_name,
           p.brand_name,
           p.product_type AS category,
           NULL AS variant,
           p.net_contents AS package_size,
           o.price_cents,
           o.currency,
           o.availability_status AS inventory_status,
           o.source_type,
           o.source_reference AS source_url,
           NULL AS image_url,
           o.observed_at AS source_updated_at,
           CASE WHEN o.confidence='high' THEN 1 ELSE 0 END AS verified,
           COALESCE(pm.image_url,NULL) AS display_image_url,
           p.product_name AS linked_product_name,
           p.brand_name AS linked_brand_name,
           p.product_type AS linked_product_type,
           p.product_type AS source_category,
           COALESCE(pc.name,p.product_type,'Other') AS display_category,
           pc.id AS canonical_category_id,
           COALESCE(pc.slug,'other') AS canonical_category_slug,
           COALESCE(pc.name,p.product_type,'Other') AS canonical_category_name,
           'product' AS canonical_category_source,
           b.batch_number AS linked_batch_number,
           b.uid AS linked_uid,
           b.overall_status AS linked_batch_status,
           b.verified AS linked_batch_verified
      FROM cannabis_product_availability_observations o
      JOIN cannabis_products p ON p.id=o.product_id
      LEFT JOIN cannabis_product_categories pc ON pc.id=p.category_id
      LEFT JOIN cannabis_batches b ON b.id=o.batch_id
      LEFT JOIN cannabis_product_media pm ON pm.id=(
        SELECT pm2.id FROM cannabis_product_media pm2
         WHERE pm2.product_id=o.product_id
         ORDER BY pm2.is_primary DESC,pm2.updated_at DESC LIMIT 1
      )
     WHERE o.dispensary_id=?
       AND o.expires_at>?
       AND o.availability_status<>'not_seen'
     ORDER BY o.observed_at DESC
  `).all(dispensaryId,new Date().toISOString()) as any[];

  const seen = new Set(items.map((item:any)=>`${String(item.product_id||'')}|${String(item.batch_id||'')}`));
  for(const observation of observations){
    const key=`${String(observation.product_id||'')}|${String(observation.batch_id||'')}`;
    if(seen.has(key))continue;
    items.push(observation);
    seen.add(key);
  }
  return items;
}

export function saveScanHistory(input: { userId: string; identifierType: string; identifierValue: string; productId?: string | null; batchId?: string | null; matchLevel?: string | null }) {
  const db = ensureSchema();
  const id = `scan-${randomUUID()}`;
  db.prepare('INSERT INTO cannabis_scan_history (id,user_id,identifier_type,identifier_value,product_id,batch_id,match_level,scanned_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, input.userId, input.identifierType, input.identifierValue, input.productId || null, input.batchId || null, input.matchLevel || null, new Date().toISOString());
  return id;
}

export function createScanContribution(input: ScanContributionInput) {
  const db = ensureSchema();
  const id = `wfsub-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO cannabis_product_submissions (
      id,submitted_by_user_id,identifier_type,identifier_value,product_id,batch_id,dispensary_id,
      brand_name,product_name,product_type,net_contents,batch_number,uid,coa_url,source_url,notes,
      requested_menu_add,menu_item_json,status,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`)
    .run(id, input.userId, input.identifierType, input.identifierValue.trim(), input.productId || null, input.batchId || null, input.dispensaryId || null,
      input.brandName || null, input.productName || null, input.productType || null, input.netContents || null, input.batchNumber || null, input.uid || null,
      input.coaUrl || null, input.sourceUrl || null, input.notes || null, input.menu && input.dispensaryId ? 1 : 0, input.menu ? JSON.stringify(input.menu) : null, now, now);
  return db.prepare('SELECT * FROM cannabis_product_submissions WHERE id=?').get(id) as any;
}
