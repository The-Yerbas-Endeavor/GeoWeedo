import { createHash, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { addDispensaryMenuItem, ensureWeedoMenuSchema, getOrCreateDispensaryMenu, listDispensaryMenu } from '@/lib/weedoMenus';
import { ensureWeedoFactsSchema } from '@/lib/weedoFacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
function forbidden(message = 'Forbidden.') { return NextResponse.json({ error: message }, { status: 403 }); }
function invalid(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }
function text(value: unknown) { return String(value ?? '').trim(); }
function optional(value: unknown) { const valueText = text(value); return valueText || null; }

function ensureOwnerMenuScanSchema(db: ReturnType<typeof getDatabase>) {
  const columns = db.prepare('PRAGMA table_info(dispensary_menu_items)').all() as any[];
  const names = new Set(columns.map(column => String(column.name)));
  if (!names.has('owner_scan_type')) db.exec('ALTER TABLE dispensary_menu_items ADD COLUMN owner_scan_type TEXT');
  if (!names.has('owner_scan_value')) db.exec('ALTER TABLE dispensary_menu_items ADD COLUMN owner_scan_value TEXT');
  if (!names.has('owner_admin_user_id')) db.exec('ALTER TABLE dispensary_menu_items ADD COLUMN owner_admin_user_id TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS dispensary_owner_menu_scans (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      dispensary_id TEXT NOT NULL,
      identifier_type TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      resolution_status TEXT NOT NULL,
      product_id TEXT,
      batch_id TEXT,
      menu_item_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
      FOREIGN KEY(dispensary_id) REFERENCES dispensaries(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE SET NULL,
      FOREIGN KEY(batch_id) REFERENCES cannabis_batches(id) ON DELETE SET NULL,
      FOREIGN KEY(menu_item_id) REFERENCES dispensary_menu_items(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS dispensary_owner_menu_scans_owner_idx
      ON dispensary_owner_menu_scans(admin_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS dispensary_owner_menu_scans_code_idx
      ON dispensary_owner_menu_scans(identifier_type, identifier_value);
    CREATE INDEX IF NOT EXISTS dispensary_menu_items_owner_scan_idx
      ON dispensary_menu_items(menu_id, owner_scan_type, owner_scan_value);
  `);
}

function ensure() {
  ensureWeedoFactsSchema();
  ensureWeedoMenuSchema();
  const db = getDatabase();
  ensureOwnerMenuScanSchema(db);
  return db;
}

function ownerAssignment(db: ReturnType<typeof getDatabase>, adminId: string, dispensaryId: string) {
  return db.prepare(`
    SELECT o.location_id, d.name, d.city, d.region
    FROM dispensary_owner_assignments o
    JOIN dispensaries d ON d.id=o.location_id
    WHERE o.admin_user_id=?
      AND o.location_id=?
      AND o.status='verified'
      AND d.active=1
      AND d.verified=1
    LIMIT 1
  `).get(adminId, dispensaryId) as any;
}

function ownerLocations(db: ReturnType<typeof getDatabase>, adminId: string) {
  return db.prepare(`
    SELECT o.location_id, d.name, d.city, d.region
    FROM dispensary_owner_assignments o
    JOIN dispensaries d ON d.id=o.location_id
    WHERE o.admin_user_id=?
      AND o.status='verified'
      AND d.active=1
      AND d.verified=1
    ORDER BY d.name COLLATE NOCASE
  `).all(adminId) as any[];
}

function normalizeScanType(value: unknown, scanValue: string) {
  const supplied = text(value).toLowerCase();
  if (['qr', 'upc', 'barcode'].includes(supplied)) return supplied;
  if (/^https?:\/\//i.test(scanValue)) return 'qr';
  if (/^\d{8,14}$/.test(scanValue.replace(/[\s-]/g, ''))) return 'upc';
  return 'barcode';
}

function stableUnresolvedKey(scanType: string, scanValue: string) {
  const digest = createHash('sha256').update(`${scanType}:${scanValue.trim()}`).digest('hex').slice(0, 24);
  return `owner-unresolved:${scanType}:${digest}`;
}

function recordOwnerMenuScan(db: ReturnType<typeof getDatabase>, input: {
  adminId: string;
  dispensaryId: string;
  scanType: string;
  scanValue: string;
  resolutionStatus: string;
  productId?: string | null;
  batchId?: string | null;
  menuItemId?: string | null;
}) {
  db.prepare(`
    INSERT INTO dispensary_owner_menu_scans
      (id,admin_user_id,dispensary_id,identifier_type,identifier_value,resolution_status,product_id,batch_id,menu_item_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    `ownerscan-${randomUUID()}`,
    input.adminId,
    input.dispensaryId,
    input.scanType,
    input.scanValue,
    input.resolutionStatus,
    input.productId || null,
    input.batchId || null,
    input.menuItemId || null,
    new Date().toISOString(),
  );
}

function ownerMenuItem(db: ReturnType<typeof getDatabase>, adminId: string, dispensaryId: string, itemId: string) {
  return db.prepare(`
    SELECT mi.*,m.dispensary_id
    FROM dispensary_menu_items mi
    JOIN dispensary_menus m ON m.id=mi.menu_id
    JOIN dispensary_owner_assignments o ON o.location_id=m.dispensary_id
    WHERE mi.id=? AND m.dispensary_id=? AND o.admin_user_id=? AND o.status='verified'
    LIMIT 1
  `).get(itemId, dispensaryId, adminId) as any;
}

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return unauthorized();
  if (admin.role !== 'verified_dispensary') return forbidden('Verified dispensary owner/operator access is required.');

  const db = ensure();
  const locations = ownerLocations(db, admin.id);
  const requested = text(request.nextUrl.searchParams.get('dispensaryId'));
  const selected = requested || String(locations[0]?.location_id || '');
  if (!selected) return NextResponse.json({ locations, menuItems: [] }, { headers: { 'Cache-Control': 'no-store' } });
  if (!ownerAssignment(db, admin.id, selected)) return forbidden('This dispensary is not assigned to your account.');

  return NextResponse.json({
    locations,
    dispensaryId: selected,
    menuItems: listDispensaryMenu(selected),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return unauthorized();
  if (admin.role !== 'verified_dispensary') return forbidden('Verified dispensary owner/operator access is required.');

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return invalid('Invalid JSON body.');

  const dispensaryId = text((body as any).dispensaryId);
  const productId = optional((body as any).productId);
  const batchId = optional((body as any).batchId);
  const scanValue = text((body as any).scanValue);
  const scanType = normalizeScanType((body as any).identifierType, scanValue);
  const itemName = text((body as any).itemName);
  const brandName = optional((body as any).brandName);
  const category = optional((body as any).category);
  const variant = optional((body as any).variant);
  const packageSize = optional((body as any).packageSize);
  const inventoryStatus = optional((body as any).inventoryStatus) || 'in_stock';
  const sourceUrl = optional((body as any).sourceUrl) || (/^https?:\/\//i.test(scanValue) ? scanValue : null);
  const priceRaw = text((body as any).price);

  if (!dispensaryId) return invalid('Dispensary is required.');
  if (!itemName) return invalid('Menu item name is required.');
  if (!scanValue) return invalid('The scanned QR/barcode value is required.');

  const db = ensure();
  const assignment = ownerAssignment(db, admin.id, dispensaryId);
  if (!assignment) return forbidden('This dispensary is not assigned to your account.');

  let product: any = null;
  if (productId) {
    product = db.prepare(`
      SELECT id,brand_name,product_name,product_type,net_contents
      FROM cannabis_products WHERE id=? LIMIT 1
    `).get(productId) as any;
    if (!product) return invalid('The scanned product is not present in the GeoWeedo product database.');
  }

  let batch: any = null;
  if (batchId) {
    if (!productId) return invalid('A batch cannot be linked without its canonical product.');
    batch = db.prepare(`
      SELECT id,product_id,batch_number,uid,verified,source_type
      FROM cannabis_batches WHERE id=? LIMIT 1
    `).get(batchId) as any;
    if (!batch || batch.product_id !== productId) return invalid('The scanned batch is not linked to this product.');
  }

  const price = priceRaw ? Number(priceRaw) : null;
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100000)) {
    return invalid('Price must be a valid non-negative amount.');
  }
  if (!['in_stock', 'low_stock', 'unknown', 'out_of_stock'].includes(inventoryStatus)) {
    return invalid('Invalid inventory status.');
  }

  const menu = getOrCreateDispensaryMenu(dispensaryId, { sourceType: 'verified_owner_scan', sourceUrl });
  const sameScan = db.prepare(`
    SELECT id,external_item_id
    FROM dispensary_menu_items
    WHERE menu_id=? AND owner_scan_type=? AND owner_scan_value=?
    ORDER BY active DESC,updated_at DESC LIMIT 1
  `).get(menu.id, scanType, scanValue) as any;

  const canonicalKey = productId ? `owner-scan:${batchId || productId}` : stableUnresolvedKey(scanType, scanValue);
  let externalItemId = sameScan?.external_item_id || canonicalKey;

  // Preserve an existing owner-scanned menu row when an identifier that used to
  // be unresolved later becomes a canonical Weedo Facts product.
  if (!sameScan && productId) {
    const legacy = db.prepare(`
      SELECT id,external_item_id FROM dispensary_menu_items
      WHERE menu_id=? AND external_item_id=? LIMIT 1
    `).get(menu.id, canonicalKey) as any;
    if (legacy?.external_item_id) externalItemId = legacy.external_item_id;
  }

  const itemId = addDispensaryMenuItem({
    dispensaryId,
    productId,
    batchId,
    externalItemId,
    itemName,
    brandName: brandName || product?.brand_name || null,
    category: category || product?.product_type || null,
    variant,
    packageSize: packageSize || product?.net_contents || null,
    priceCents: price === null ? null : Math.round(price * 100),
    currency: 'USD',
    inventoryStatus,
    sourceType: productId ? 'verified_owner_scan' : 'owner_reported_scan',
    sourceUrl,
    sourceUpdatedAt: new Date().toISOString(),
    // "verified" here means the verified owner confirms this is on their menu.
    // It does not make an unresolved scan a lab-verified Weedo Facts product.
    verified: true,
  });

  db.prepare(`
    UPDATE dispensary_menu_items
    SET owner_scan_type=?,owner_scan_value=?,owner_admin_user_id=?,updated_at=?
    WHERE id=?
  `).run(scanType, scanValue, admin.id, new Date().toISOString(), itemId);

  recordOwnerMenuScan(db, {
    adminId: admin.id,
    dispensaryId,
    scanType,
    scanValue,
    resolutionStatus: productId ? (batch?.verified ? 'verified_batch' : 'canonical_product') : 'owner_reported_unresolved',
    productId,
    batchId,
    menuItemId: itemId,
  });

  return NextResponse.json({
    ok: true,
    itemId,
    dispensary: assignment,
    resolution: productId ? 'canonical' : 'owner_reported',
    product: product ? {
      id: product.id,
      productName: product.product_name,
      brandName: product.brand_name,
      batchId: batch?.id || null,
      batchNumber: batch?.batch_number || null,
      uid: batch?.uid || null,
      verifiedLabBatch: Boolean(batch?.verified === 1 && String(batch?.source_type || '').toLowerCase() === 'lab'),
    } : null,
    menuItems: listDispensaryMenu(dispensaryId),
  }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return unauthorized();
  if (admin.role !== 'verified_dispensary') return forbidden('Verified dispensary owner/operator access is required.');

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return invalid('Invalid JSON body.');
  const dispensaryId = text((body as any).dispensaryId);
  const itemId = text((body as any).itemId);
  if (!dispensaryId || !itemId) return invalid('Dispensary and menu item are required.');

  const db = ensure();
  if (!ownerAssignment(db, admin.id, dispensaryId)) return forbidden('This dispensary is not assigned to your account.');
  const current = ownerMenuItem(db, admin.id, dispensaryId, itemId);
  if (!current) return forbidden('This menu item is not assigned to your dispensary.');

  const itemName = text((body as any).itemName) || String(current.item_name || '');
  const brandName = (body as any).brandName === undefined ? current.brand_name : optional((body as any).brandName);
  const category = (body as any).category === undefined ? current.category : optional((body as any).category);
  const variant = (body as any).variant === undefined ? current.variant : optional((body as any).variant);
  const packageSize = (body as any).packageSize === undefined ? current.package_size : optional((body as any).packageSize);
  const inventoryStatus = text((body as any).inventoryStatus) || String(current.inventory_status || 'unknown');
  if (!['in_stock', 'low_stock', 'unknown', 'out_of_stock'].includes(inventoryStatus)) return invalid('Invalid inventory status.');

  let priceCents = current.price_cents as number | null;
  if ((body as any).price !== undefined) {
    const raw = text((body as any).price);
    if (!raw) priceCents = null;
    else {
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return invalid('Price must be a valid non-negative amount.');
      priceCents = Math.round(amount * 100);
    }
  }

  db.prepare(`
    UPDATE dispensary_menu_items SET
      item_name=?,brand_name=?,category=?,variant=?,package_size=?,price_cents=?,inventory_status=?,source_updated_at=?,updated_at=?
    WHERE id=?
  `).run(itemName, brandName, category, variant, packageSize, priceCents, inventoryStatus, new Date().toISOString(), new Date().toISOString(), itemId);

  return NextResponse.json({ ok: true, menuItems: listDispensaryMenu(dispensaryId) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return unauthorized();
  if (admin.role !== 'verified_dispensary') return forbidden('Verified dispensary owner/operator access is required.');

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return invalid('Invalid JSON body.');
  const dispensaryId = text((body as any).dispensaryId);
  const itemId = text((body as any).itemId);
  if (!dispensaryId || !itemId) return invalid('Dispensary and menu item are required.');

  const db = ensure();
  if (!ownerAssignment(db, admin.id, dispensaryId)) return forbidden('This dispensary is not assigned to your account.');
  const current = ownerMenuItem(db, admin.id, dispensaryId, itemId);
  if (!current) return forbidden('This menu item is not assigned to your dispensary.');

  db.prepare('UPDATE dispensary_menu_items SET active=0,updated_at=? WHERE id=?').run(new Date().toISOString(), itemId);
  return NextResponse.json({ ok: true, menuItems: listDispensaryMenu(dispensaryId) }, { headers: { 'Cache-Control': 'no-store' } });
}
