import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { createWeedoFactsProduct, ensureWeedoFactsSchema } from '@/lib/weedoFacts';
import { ensureWeedoFactsQrSchema } from '@/lib/weedoFactsQrPersistence';
import { addDispensaryMenuItem, ensureWeedoMenuSchema, listDispensaryMenu, setProductPrimaryImage } from '@/lib/weedoMenus';
import { assignProductCategory, ensureProductCategorySchema, listProductCategories, resolveProductCategory } from '@/lib/productCategories';

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

const PRODUCT_SORTS: Record<string, string> = {
  updated_desc: "p.updated_at DESC,p.product_name COLLATE NOCASE ASC",
  updated_asc: "p.updated_at ASC,p.product_name COLLATE NOCASE ASC",
  name_asc: "p.product_name COLLATE NOCASE ASC,COALESCE(p.brand_name,'') COLLATE NOCASE ASC",
  name_desc: "p.product_name COLLATE NOCASE DESC,COALESCE(p.brand_name,'') COLLATE NOCASE ASC",
  brand_asc: "COALESCE(p.brand_name,'') COLLATE NOCASE ASC,p.product_name COLLATE NOCASE ASC",
  brand_desc: "COALESCE(p.brand_name,'') COLLATE NOCASE DESC,p.product_name COLLATE NOCASE ASC",
  batches_desc: "batch_count DESC,p.product_name COLLATE NOCASE ASC",
  menus_desc: "menu_count DESC,p.product_name COLLATE NOCASE ASC",
};

function productCatalog(search = '', requestedPage = 1, requestedPageSize = 50, requestedSort = 'updated_desc') {
  const db = ensure();
  const q = search.trim().toLowerCase();
  const pageSize = Math.max(10, Math.min(100, Math.floor(requestedPageSize) || 50));
  const sort = PRODUCT_SORTS[requestedSort] ? requestedSort : 'updated_desc';
  const orderBy = PRODUCT_SORTS[sort];
  const params: string[] = [];
  const where = q
    ? `WHERE LOWER(COALESCE(p.brand_name,'') || ' ' || p.product_name || ' ' || COALESCE(p.product_type,'') || ' ' || COALESCE(c.name,'') || ' ' || COALESCE(p.net_contents,'')) LIKE ?`
    : '';
  if (q) params.push(`%${q}%`);

  const total = Number((db.prepare(`
    SELECT COUNT(*) AS n
      FROM cannabis_products p
      LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
      ${where}
  `).get(...params) as any)?.n || 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pageCount);
  const offset = (page - 1) * pageSize;

  const products = db.prepare(`
    SELECT p.id,p.brand_name,p.product_name,p.product_type,p.net_contents,p.category_id,p.category_source,c.name AS category_name,c.slug AS category_slug,p.created_at,p.updated_at,
           (SELECT identifier_value FROM cannabis_product_identifiers i WHERE i.product_id=p.id AND i.identifier_type IN ('upc','ean') ORDER BY i.verified DESC,i.created_at LIMIT 1) AS barcode,
           (SELECT image_url FROM cannabis_product_media pm WHERE pm.product_id=p.id ORDER BY pm.is_primary DESC,pm.updated_at DESC LIMIT 1) AS image_url,
           (SELECT COUNT(*) FROM cannabis_batches b WHERE b.product_id=p.id) AS batch_count,
           (SELECT COUNT(*) FROM dispensary_menu_items mi WHERE mi.product_id=p.id AND mi.active=1) AS menu_count
      FROM cannabis_products p
      LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
      ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as any[];

  return { products, total, page, pageSize, pageCount, sort };
}

function verifiedProductRows(productIds: string[]) {
  if (!productIds.length) return [];
  const db = ensure();
  const placeholders = productIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT p.id,p.brand_name,p.product_name,p.product_type,p.net_contents,p.category_id,c.name AS category_name,p.updated_at,
      COUNT(DISTINCT b.id) AS verified_batch_count,MAX(b.tested_at) AS latest_tested_at,
      (SELECT COUNT(*) FROM cannabis_qr_scans q WHERE q.product_id=p.id) AS qr_count,
      COALESCE((SELECT SUM(q.scan_count) FROM cannabis_qr_scans q WHERE q.product_id=p.id),0) AS qr_scan_events,
      (SELECT b2.uid FROM cannabis_batches b2 WHERE b2.product_id=p.id AND b2.verified=1 AND LOWER(b2.source_type)='lab' ORDER BY COALESCE(b2.tested_at,b2.updated_at) DESC LIMIT 1) AS latest_uid,
      (SELECT b2.coa_number FROM cannabis_batches b2 WHERE b2.product_id=p.id AND b2.verified=1 AND LOWER(b2.source_type)='lab' ORDER BY COALESCE(b2.tested_at,b2.updated_at) DESC LIMIT 1) AS latest_coa_number,
      (SELECT b2.lab_name FROM cannabis_batches b2 WHERE b2.product_id=p.id AND b2.verified=1 AND LOWER(b2.source_type)='lab' ORDER BY COALESCE(b2.tested_at,b2.updated_at) DESC LIMIT 1) AS latest_lab_name,
      (SELECT b2.overall_status FROM cannabis_batches b2 WHERE b2.product_id=p.id AND b2.verified=1 AND LOWER(b2.source_type)='lab' ORDER BY COALESCE(b2.tested_at,b2.updated_at) DESC LIMIT 1) AS latest_status
    FROM cannabis_products p
    JOIN cannabis_batches b ON b.product_id=p.id AND b.verified=1 AND LOWER(b.source_type)='lab'
    LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
    WHERE p.id IN (${placeholders})
    GROUP BY p.id
  `).all(...productIds) as any[];
}

function qrScanRows() {
  const db = ensure();
  return db.prepare(`
    SELECT q.id,q.qr_value,q.qr_host,q.resolver,q.product_id,q.batch_id,q.external_identifier,q.title,q.brand_name,q.product_name,q.product_type,q.producer_name,q.lab_name,q.tested_at,q.coa_url,q.first_seen_at,q.last_seen_at,q.scan_count,
      p.brand_name AS canonical_brand_name,p.product_name AS canonical_product_name,p.product_type AS canonical_product_type,p.net_contents AS canonical_net_contents,
      c.name AS canonical_category_name,
      b.batch_number,b.uid,b.coa_number,b.overall_status,b.lab_name AS canonical_lab_name,b.verified AS batch_verified,b.source_type AS batch_source_type,
      CASE WHEN b.verified=1 AND LOWER(COALESCE(b.source_type,''))='lab' THEN 1 ELSE 0 END AS verified_lab_batch
    FROM cannabis_qr_scans q
    LEFT JOIN cannabis_products p ON p.id=q.product_id
    LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
    LEFT JOIN cannabis_batches b ON b.id=q.batch_id
    ORDER BY q.last_seen_at DESC,q.first_seen_at DESC
    LIMIT 500
  `).all() as any[];
}

function dispensaryRows() {
  return ensure().prepare(`SELECT id,name,city,region,country FROM dispensaries WHERE active=1 AND verified=1 ORDER BY region COLLATE NOCASE,city COLLATE NOCASE,name COLLATE NOCASE`).all() as any[];
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const search = text(request.nextUrl.searchParams.get('q'));
  const requestedPage = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get('page') || 1)) || 1);
  const requestedPageSize = Math.max(10, Math.min(100, Math.floor(Number(request.nextUrl.searchParams.get('pageSize') || 50)) || 50));
  const requestedSort = text(request.nextUrl.searchParams.get('sort')) || 'updated_desc';
  const dispensaryId = text(request.nextUrl.searchParams.get('dispensaryId'));
  const db = ensure();
  const catalog = productCatalog(search, requestedPage, requestedPageSize, requestedSort);
  const stats = {
    products: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_products').get() as any)?.n || 0),
    categorizedProducts: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_products WHERE category_id IS NOT NULL').get() as any)?.n || 0),
    uncategorizedProducts: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_products WHERE category_id IS NULL').get() as any)?.n || 0),
    verifiedProducts: Number((db.prepare("SELECT COUNT(DISTINCT product_id) AS n FROM cannabis_batches WHERE verified=1 AND LOWER(source_type)='lab'").get() as any)?.n || 0),
    verifiedBatches: Number((db.prepare("SELECT COUNT(*) AS n FROM cannabis_batches WHERE verified=1 AND LOWER(source_type)='lab'").get() as any)?.n || 0),
    qrCodes: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_qr_scans').get() as any)?.n || 0),
    qrScanEvents: Number((db.prepare('SELECT COALESCE(SUM(scan_count),0) AS n FROM cannabis_qr_scans').get() as any)?.n || 0),
    unlinkedQrs: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_qr_scans WHERE product_id IS NULL OR batch_id IS NULL').get() as any)?.n || 0),
    menuItems: Number((db.prepare('SELECT COUNT(*) AS n FROM dispensary_menu_items WHERE active=1').get() as any)?.n || 0),
    storesWithMenus: Number((db.prepare('SELECT COUNT(DISTINCT m.dispensary_id) AS n FROM dispensary_menus m JOIN dispensary_menu_items mi ON mi.menu_id=m.id WHERE m.active=1 AND mi.active=1').get() as any)?.n || 0),
  };
  return NextResponse.json({
    stats,
    catalog: { total: catalog.total, page: catalog.page, pageSize: catalog.pageSize, pageCount: catalog.pageCount, sort: catalog.sort },
    categories: listProductCategories(db),
    products: catalog.products,
    verifiedProducts: verifiedProductRows(catalog.products.map(product => String(product.id))),
    qrScans: qrScanRows(),
    dispensaries: dispensaryRows(),
    menuItems: dispensaryId ? listDispensaryMenu(dispensaryId) : [],
  }, { headers: { 'Cache-Control': 'no-store' } });
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
      catch { /* product remains valid even if category assignment needs later review */ }
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
    return NextResponse.json({ itemId, menuItems: listDispensaryMenu(dispensaryId) }, { status: 201 });
  }

  return invalid('Unknown action.');
}
