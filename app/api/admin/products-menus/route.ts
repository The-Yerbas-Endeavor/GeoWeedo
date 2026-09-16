import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { createWeedoFactsProduct, ensureWeedoFactsSchema } from '@/lib/weedoFacts';
import { ensureWeedoFactsQrSchema } from '@/lib/weedoFactsQrPersistence';
import { addDispensaryMenuItem, ensureWeedoMenuSchema, listDispensaryMenu, setProductPrimaryImage } from '@/lib/weedoMenus';
import { assignProductCategory, ensureProductCategorySchema, resolveProductCategory } from '@/lib/productCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
function invalid(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }
function text(value: unknown) { return String(value ?? '').trim(); }
function optional(value: unknown) { const v = text(value); return v || null; }
function validImageUrl(value: string | null) {
  if (!value) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function ensure() {
  ensureWeedoFactsSchema();
  ensureWeedoFactsQrSchema();
  ensureWeedoMenuSchema();
  const db = getDatabase();
  ensureProductCategorySchema(db);
  return db;
}

function statsRows() {
  const db = ensure();
  return {
    products: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_products').get() as any)?.n || 0),
    verifiedProducts: Number((db.prepare("SELECT COUNT(DISTINCT product_id) AS n FROM cannabis_batches WHERE verified=1 AND LOWER(source_type)='lab'").get() as any)?.n || 0),
    verifiedBatches: Number((db.prepare("SELECT COUNT(*) AS n FROM cannabis_batches WHERE verified=1 AND LOWER(source_type)='lab'").get() as any)?.n || 0),
    qrCodes: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_qr_scans').get() as any)?.n || 0),
    unlinkedQrs: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_qr_scans WHERE product_id IS NULL').get() as any)?.n || 0),
    menuItems: Number((db.prepare('SELECT COUNT(*) AS n FROM dispensary_menu_items WHERE active=1').get() as any)?.n || 0),
    storesWithMenus: Number((db.prepare('SELECT COUNT(DISTINCT m.dispensary_id) AS n FROM dispensary_menus m JOIN dispensary_menu_items mi ON mi.menu_id=m.id WHERE m.active=1 AND mi.active=1').get() as any)?.n || 0),
  };
}

function productRows(search = '') {
  const db = ensure();
  const q = search.trim().toLowerCase();
  const params: string[] = [];
  const where = q ? `WHERE LOWER(COALESCE(p.brand_name,'') || ' ' || p.product_name || ' ' || COALESCE(p.product_type,'') || ' ' || COALESCE(c.name,'') || ' ' || COALESCE(p.net_contents,'')) LIKE ?` : '';
  if (q) params.push(`%${q}%`);
  return db.prepare(`
    SELECT p.id,p.brand_name,p.product_name,p.product_type,p.net_contents,c.name AS category_name,p.updated_at,
           (SELECT COUNT(*) FROM cannabis_batches b WHERE b.product_id=p.id) AS batch_count,
           (SELECT COUNT(*) FROM dispensary_menu_items mi WHERE mi.product_id=p.id AND mi.active=1) AS menu_count
      FROM cannabis_products p
      LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
      ${where}
     ORDER BY p.updated_at DESC,p.product_name COLLATE NOCASE
     LIMIT 80
  `).all(...params) as any[];
}

function verifiedRows(productIds: string[]) {
  if (!productIds.length) return [];
  const db = ensure();
  const placeholders = productIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT product_id AS id,COUNT(*) AS verified_batch_count,MAX(tested_at) AS latest_tested_at
      FROM cannabis_batches
     WHERE product_id IN (${placeholders}) AND verified=1 AND LOWER(source_type)='lab'
     GROUP BY product_id
  `).all(...productIds) as any[];
}

function qrScanRows(search = '', unlinkedOnly = false) {
  const db = ensure();
  const q = search.trim().toLowerCase();
  const clauses: string[] = [];
  const params: string[] = [];
  if (unlinkedOnly) clauses.push('q.product_id IS NULL');
  if (q) {
    clauses.push(`LOWER(COALESCE(q.qr_value,'') || ' ' || COALESCE(q.title,'') || ' ' || COALESCE(q.product_name,'') || ' ' || COALESCE(p.brand_name,'') || ' ' || COALESCE(p.product_name,'') || ' ' || COALESCE(b.batch_number,'') || ' ' || COALESCE(b.uid,'') || ' ' || COALESCE(b.coa_number,'')) LIKE ?`);
    params.push(`%${q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = unlinkedOnly ? 100 : 200;
  return db.prepare(`
    SELECT q.id,q.qr_value,q.qr_host,q.resolver,q.product_id,q.batch_id,q.title,q.brand_name,q.product_name,q.lab_name,q.last_seen_at,q.scan_count,
      p.brand_name AS canonical_brand_name,p.product_name AS canonical_product_name,p.product_type AS canonical_product_type,p.net_contents AS canonical_net_contents,
      c.name AS canonical_category_name,
      b.batch_number,b.uid,b.coa_number,b.overall_status,b.lab_name AS canonical_lab_name,
      CASE WHEN b.verified=1 AND LOWER(COALESCE(b.source_type,''))='lab' THEN 1 ELSE 0 END AS verified_lab_batch
    FROM cannabis_qr_scans q
    LEFT JOIN cannabis_products p ON p.id=q.product_id
    LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
    LEFT JOIN cannabis_batches b ON b.id=q.batch_id
    ${where}
    ORDER BY q.last_seen_at DESC,q.first_seen_at DESC
    LIMIT ${limit}
  `).all(...params) as any[];
}

function dispensaryRows(search = '') {
  const db = ensure();
  const q = search.trim().toLowerCase();
  if (!q) {
    return db.prepare(`SELECT id,name,city,region,country FROM dispensaries WHERE active=1 AND verified=1 ORDER BY name COLLATE NOCASE LIMIT 100`).all() as any[];
  }
  return db.prepare(`
    SELECT id,name,city,region,country
      FROM dispensaries
     WHERE active=1 AND verified=1
       AND LOWER(COALESCE(name,'') || ' ' || COALESCE(city,'') || ' ' || COALESCE(region,'') || ' ' || COALESCE(country,'')) LIKE ?
     ORDER BY name COLLATE NOCASE
     LIMIT 100
  `).all(`%${q}%`) as any[];
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const search = text(request.nextUrl.searchParams.get('q'));
  const view = text(request.nextUrl.searchParams.get('view')) || 'products';

  if (view === 'dispensaries') {
    return NextResponse.json({ dispensaries: dispensaryRows(search) }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const stats = statsRows();
  if (view === 'scans') {
    return NextResponse.json({ stats, qrScans: qrScanRows(search, false) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (view === 'exceptions') {
    return NextResponse.json({ stats, qrScans: qrScanRows(search, true) }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const products = productRows(search);
  const verifiedProducts = verifiedRows(products.map(row => String(row.id)));
  return NextResponse.json({ stats, products, verifiedProducts }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return invalid('Invalid JSON body.');
  const action = text((body as any).action);
  const db = ensure();

  if (action === 'assign-product-category') {
    const productId = text((body as any).productId);
    const categoryId = text((body as any).categoryId);
    if (!productId || !categoryId) return invalid('Product and category are required.');
    try {
      const category = assignProductCategory(productId, categoryId, 'admin', db);
      return NextResponse.json({ ok: true, productId, category });
    } catch (error) {
      return invalid(error instanceof Error ? error.message : 'Could not assign product category.');
    }
  }

  if (action === 'create-product') {
    const brandName = optional((body as any).brandName);
    const productName = text((body as any).productName);
    const productType = optional((body as any).productType);
    const categoryId = optional((body as any).categoryId);
    const netContents = optional((body as any).netContents);
    const barcode = text((body as any).barcode).replace(/\s+/g, '');
    const imageUrl = optional((body as any).imageUrl);
    if (!productName) return invalid('Product name is required.');
    if (barcode && !/^\d{8,14}$/.test(barcode)) return invalid('UPC/EAN must contain 8 to 14 digits.');
    if (!validImageUrl(imageUrl)) return invalid('Product image URL must be a valid HTTPS URL.');

    const normalized = `${brandName || ''} ${productName}`.trim().toLowerCase();
    const existing = db.prepare('SELECT id,brand_name,product_name FROM cannabis_products WHERE normalized_name=? LIMIT 1').get(normalized) as any;
    if (existing) return NextResponse.json({ error: 'A product with this brand and name already exists.', productId: existing.id }, { status: 409 });
    if (barcode) {
      const barcodeHit = db.prepare("SELECT product_id FROM cannabis_product_identifiers WHERE identifier_type IN ('upc','ean') AND identifier_value=? LIMIT 1").get(barcode) as any;
      if (barcodeHit) return NextResponse.json({ error: 'That UPC/EAN is already assigned to another product.', productId: barcodeHit.product_id }, { status: 409 });
    }

    const productId = createWeedoFactsProduct({ brandName, productName, productType, netContents });
    const mapped = categoryId || resolveProductCategory(productType, db)?.id || null;
    if (mapped) {
      try { assignProductCategory(productId, mapped, categoryId ? 'admin' : 'auto', db); }
      catch { /* product remains usable if category assignment needs review */ }
    }
    if (barcode) db.prepare('INSERT INTO cannabis_product_identifiers (id,product_id,identifier_type,identifier_value,source,verified,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(`pid-${randomUUID()}`, productId, barcode.length === 12 ? 'upc' : 'ean', barcode, 'admin-manual', 0, new Date().toISOString());
    if (imageUrl) setProductPrimaryImage(productId, imageUrl, { sourceType: 'admin-manual' });
    return NextResponse.json({ productId }, { status: 201 });
  }

  if (action === 'add-menu-item') {
    const dispensaryId = text((body as any).dispensaryId);
    const productId = text((body as any).productId);
    const itemName = text((body as any).itemName);
    const priceRaw = text((body as any).price);
    const sourceUrl = optional((body as any).sourceUrl);
    const imageUrl = optional((body as any).imageUrl);
    if (!dispensaryId) return invalid('Dispensary is required.');
    if (!productId) return invalid('Product is required.');
    if (!itemName) return invalid('Menu item name is required.');
    if (!validImageUrl(imageUrl)) return invalid('Product image URL must be a valid HTTPS URL.');
    if (!db.prepare('SELECT id FROM dispensaries WHERE id=? AND active=1 AND verified=1').get(dispensaryId)) return invalid('Dispensary is not active or verified.');
    const product = db.prepare('SELECT id,brand_name,product_name,product_type,category_id FROM cannabis_products WHERE id=?').get(productId) as any;
    if (!product) return invalid('Product was not found.');

    const existing = db.prepare(`
      SELECT mi.id
        FROM dispensary_menu_items mi
        JOIN dispensary_menus m ON m.id=mi.menu_id
       WHERE m.dispensary_id=? AND m.active=1 AND mi.product_id=? AND mi.active=1
       LIMIT 1
    `).get(dispensaryId, productId) as any;
    if (existing?.id) return NextResponse.json({ ok: true, alreadyLinked: true, itemId: existing.id });

    const price = priceRaw ? Number(priceRaw) : null;
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100000)) return invalid('Price must be a valid non-negative amount.');
    const verified = Boolean((body as any).verified && sourceUrl);

    const itemId = addDispensaryMenuItem({
      dispensaryId,productId,itemName,
      brandName: optional((body as any).brandName) || product.brand_name || null,
      category: optional((body as any).category) || product.product_type || null,
      categoryId: optional((body as any).categoryId) || product.category_id || null,
      categorySource: optional((body as any).categoryId) ? 'admin' : 'product',
      variant: optional((body as any).variant),packageSize: optional((body as any).packageSize),
      priceCents: price === null ? null : Math.round(price * 100),currency: 'USD',
      inventoryStatus: optional((body as any).inventoryStatus) || 'in_stock',sourceType: sourceUrl ? 'menu_source' : 'admin-manual',
      sourceUrl,imageUrl,sourceUpdatedAt: new Date().toISOString(),verified,
    });
    return NextResponse.json({ ok: true, alreadyLinked: false, itemId, menuItems: listDispensaryMenu(dispensaryId) }, { status: 201 });
  }

  return invalid('Unknown action.');
}
