import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { ensureWeedoFactsSchema } from '@/lib/weedoFacts';
import { ensureWeedoFactsQrSchema } from '@/lib/weedoFactsQrPersistence';
import { ensureWeedoMenuSchema } from '@/lib/weedoMenus';
import { ensureProductCategorySchema } from '@/lib/productCategories';
import {
  ensureProductMaintenanceSchema,
  mergeCanonicalProducts,
  updateCanonicalProduct,
} from '@/lib/productMaintenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
function invalid(message: string, extra?: Record<string, unknown>) { return NextResponse.json({ error: message, ...(extra || {}) }, { status: 400 }); }
function text(value: unknown) { return String(value ?? '').trim(); }

function ensure() {
  ensureWeedoFactsSchema();
  ensureWeedoFactsQrSchema();
  ensureWeedoMenuSchema();
  const db = getDatabase();
  ensureProductCategorySchema(db);
  ensureProductMaintenanceSchema(db);

  // Product Maintenance is an interactive admin screen. These indexes keep its
  // duplicate lookup and page-level linked-row counts from scanning whole tables.
  db.exec(`
    CREATE INDEX IF NOT EXISTS cannabis_products_normalized_name_maintenance_idx
      ON cannabis_products(normalized_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS cannabis_batches_product_maintenance_idx
      ON cannabis_batches(product_id);
    CREATE INDEX IF NOT EXISTS cannabis_product_identifiers_product_maintenance_idx
      ON cannabis_product_identifiers(product_id);
    CREATE INDEX IF NOT EXISTS cannabis_product_variants_product_maintenance_idx
      ON cannabis_product_variants(product_id);
    CREATE INDEX IF NOT EXISTS dispensary_menu_items_product_maintenance_idx
      ON dispensary_menu_items(product_id);
    CREATE INDEX IF NOT EXISTS cannabis_qr_scans_product_maintenance_idx
      ON cannabis_qr_scans(product_id);
  `);
  return db;
}

const SORTS: Record<string, string> = {
  name_asc: "p.product_name COLLATE NOCASE ASC,COALESCE(p.brand_name,'') COLLATE NOCASE ASC",
  name_desc: "p.product_name COLLATE NOCASE DESC,COALESCE(p.brand_name,'') COLLATE NOCASE ASC",
  brand_asc: "COALESCE(p.brand_name,'') COLLATE NOCASE ASC,p.product_name COLLATE NOCASE ASC",
  brand_desc: "COALESCE(p.brand_name,'') COLLATE NOCASE DESC,p.product_name COLLATE NOCASE ASC",
  updated_desc: 'p.updated_at DESC,p.product_name COLLATE NOCASE ASC',
  updated_asc: 'p.updated_at ASC,p.product_name COLLATE NOCASE ASC',
  batches_desc: 'COALESCE(bc.batch_count,0) DESC,p.product_name COLLATE NOCASE ASC',
  batches_asc: 'COALESCE(bc.batch_count,0) ASC,p.product_name COLLATE NOCASE ASC',
  duplicates: "possible_duplicate_count DESC,p.product_name COLLATE NOCASE ASC,COALESCE(p.brand_name,'') COLLATE NOCASE ASC",
};

type Db = ReturnType<typeof getDatabase>;

type CountRow = { product_id: string; n: number };

function countMapForPage(db: Db, table: string, productIds: string[]) {
  const counts = new Map<string, number>();
  if (!productIds.length) return counts;
  const placeholders = productIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT product_id,COUNT(*) AS n
    FROM ${table}
    WHERE product_id IN (${placeholders})
    GROUP BY product_id
  `).all(...productIds) as CountRow[];
  for (const row of rows) counts.set(String(row.product_id), Number(row.n || 0));
  return counts;
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const db = ensure();
  const q = text(request.nextUrl.searchParams.get('q')).toLowerCase();
  const requestedPage = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get('page') || 1)) || 1);
  const pageSize = Math.max(10, Math.min(100, Math.floor(Number(request.nextUrl.searchParams.get('pageSize') || 25)) || 25));
  const sort = text(request.nextUrl.searchParams.get('sort')) || 'duplicates';
  const orderBy = SORTS[sort] || SORTS.duplicates;
  const needsBatchSort = sort === 'batches_desc' || sort === 'batches_asc';
  const params: string[] = [];
  let where = '';
  if (q) {
    where = `WHERE LOWER(COALESCE(p.brand_name,'') || ' ' || p.product_name || ' ' || COALESCE(p.product_type,'') || ' ' || COALESCE(p.net_contents,'') || ' ' || COALESCE(c.name,'')) LIKE ?`;
    params.push(`%${q}%`);
  }

  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM cannabis_products p LEFT JOIN cannabis_product_categories c ON c.id=p.category_id ${where}`).get(...params) as any)?.n || 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;

  // Do the expensive catalog-wide work once, then limit to the requested page.
  // Linked-data counts are intentionally NOT calculated here; they are fetched
  // only for the 10-100 products that actually appear on the page below.
  const batchJoin = needsBatchSort ? `
    LEFT JOIN (
      SELECT product_id,COUNT(*) AS batch_count
      FROM cannabis_batches
      GROUP BY product_id
    ) bc ON bc.product_id=p.id
  ` : '';

  const pageRows = db.prepare(`
    WITH duplicate_counts AS (
      SELECT normalized_name COLLATE NOCASE AS normalized_key,COUNT(*) AS group_count
      FROM cannabis_products
      WHERE normalized_name IS NOT NULL AND normalized_name<>''
      GROUP BY normalized_name COLLATE NOCASE
    )
    SELECT p.id,p.brand_name,p.product_name,p.product_type,p.net_contents,p.normalized_name,p.updated_at,
      p.category_id,c.name AS category_name,
      CASE WHEN COALESCE(dc.group_count,0)>1 THEN dc.group_count-1 ELSE 0 END AS possible_duplicate_count
    FROM cannabis_products p
    LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
    LEFT JOIN duplicate_counts dc ON dc.normalized_key=p.normalized_name COLLATE NOCASE
    ${batchJoin}
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as any[];

  const productIds = pageRows.map(row => String(row.id));
  const batchCounts = countMapForPage(db, 'cannabis_batches', productIds);
  const identifierCounts = countMapForPage(db, 'cannabis_product_identifiers', productIds);
  const variantCounts = countMapForPage(db, 'cannabis_product_variants', productIds);
  const menuCounts = countMapForPage(db, 'dispensary_menu_items', productIds);
  const qrCounts = countMapForPage(db, 'cannabis_qr_scans', productIds);

  const products = pageRows.map(row => ({
    ...row,
    batch_count: batchCounts.get(String(row.id)) || 0,
    identifier_count: identifierCounts.get(String(row.id)) || 0,
    variant_count: variantCounts.get(String(row.id)) || 0,
    menu_count: menuCounts.get(String(row.id)) || 0,
    qr_count: qrCounts.get(String(row.id)) || 0,
  }));

  const duplicateGroups = Number((db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT normalized_name COLLATE NOCASE AS k
      FROM cannabis_products
      WHERE normalized_name IS NOT NULL AND normalized_name<>''
      GROUP BY normalized_name COLLATE NOCASE
      HAVING COUNT(*)>1
    )
  `).get() as any)?.n || 0);

  const mergedCount = Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_product_merge_history').get() as any)?.n || 0);
  return NextResponse.json({ products, total, page, pageSize, pageCount, sort, duplicateGroups, mergedCount }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return invalid('Invalid JSON body.');
  const action = text((body as any).action);
  const db = ensure();

  if (action === 'update-product') {
    const productId = text((body as any).productId);
    const productName = text((body as any).productName);
    if (!productId || !productName) return invalid('Product and product name are required.');
    try {
      const product = updateCanonicalProduct({ productId, productName, brandName: (body as any).brandName }, db);
      return NextResponse.json({ ok: true, product });
    } catch (error) {
      const duplicateProductId = (error as Error & { duplicateProductId?: string })?.duplicateProductId;
      if (duplicateProductId) return NextResponse.json({ error: error instanceof Error ? error.message : 'Duplicate product exists.', duplicateProductId }, { status: 409 });
      return invalid(error instanceof Error ? error.message : 'Could not update product.');
    }
  }

  if (action === 'merge-product') {
    const sourceProductId = text((body as any).sourceProductId);
    const targetProductId = text((body as any).targetProductId);
    if (!sourceProductId || !targetProductId) return invalid('Duplicate and surviving products are required.');
    try {
      const result = mergeCanonicalProducts({ sourceProductId, targetProductId }, db);
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      return invalid(error instanceof Error ? error.message : 'Could not merge products safely.');
    }
  }

  return invalid('Unknown action.');
}
