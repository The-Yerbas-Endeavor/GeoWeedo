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
  return db;
}

const SORTS: Record<string, string> = {
  name_asc: "p.product_name COLLATE NOCASE ASC,COALESCE(p.brand_name,'') COLLATE NOCASE ASC",
  name_desc: "p.product_name COLLATE NOCASE DESC,COALESCE(p.brand_name,'') COLLATE NOCASE ASC",
  brand_asc: "COALESCE(p.brand_name,'') COLLATE NOCASE ASC,p.product_name COLLATE NOCASE ASC",
  brand_desc: "COALESCE(p.brand_name,'') COLLATE NOCASE DESC,p.product_name COLLATE NOCASE ASC",
  updated_desc: 'p.updated_at DESC,p.product_name COLLATE NOCASE ASC',
  updated_asc: 'p.updated_at ASC,p.product_name COLLATE NOCASE ASC',
  batches_desc: 'batch_count DESC,p.product_name COLLATE NOCASE ASC',
  batches_asc: 'batch_count ASC,p.product_name COLLATE NOCASE ASC',
  duplicates: 'possible_duplicate_count DESC,p.product_name COLLATE NOCASE ASC,COALESCE(p.brand_name,\'\') COLLATE NOCASE ASC',
};

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const db = ensure();
  const q = text(request.nextUrl.searchParams.get('q')).toLowerCase();
  const requestedPage = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get('page') || 1)) || 1);
  const pageSize = Math.max(10, Math.min(100, Math.floor(Number(request.nextUrl.searchParams.get('pageSize') || 25)) || 25));
  const sort = text(request.nextUrl.searchParams.get('sort')) || 'duplicates';
  const orderBy = SORTS[sort] || SORTS.duplicates;
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

  const products = db.prepare(`
    SELECT p.id,p.brand_name,p.product_name,p.product_type,p.net_contents,p.normalized_name,p.updated_at,
      p.category_id,c.name AS category_name,
      (SELECT COUNT(*) FROM cannabis_batches b WHERE b.product_id=p.id) AS batch_count,
      (SELECT COUNT(*) FROM cannabis_product_identifiers i WHERE i.product_id=p.id) AS identifier_count,
      (SELECT COUNT(*) FROM cannabis_product_variants v WHERE v.product_id=p.id) AS variant_count,
      (SELECT COUNT(*) FROM dispensary_menu_items mi WHERE mi.product_id=p.id) AS menu_count,
      (SELECT COUNT(*) FROM cannabis_qr_scans qrs WHERE qrs.product_id=p.id) AS qr_count,
      (SELECT COUNT(*) FROM cannabis_products d
        WHERE d.id<>p.id
          AND LOWER(TRIM(COALESCE(d.normalized_name,'')))=LOWER(TRIM(COALESCE(p.normalized_name,'')))
          AND TRIM(COALESCE(p.normalized_name,''))<>'') AS possible_duplicate_count
    FROM cannabis_products p
    LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as any[];

  const duplicateGroups = Number((db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT LOWER(TRIM(normalized_name)) AS k
      FROM cannabis_products
      WHERE TRIM(COALESCE(normalized_name,''))<>''
      GROUP BY LOWER(TRIM(normalized_name))
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
