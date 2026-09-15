import { getDatabase } from './sqlite.ts';
import { ensureWeedoFactsSchema } from './weedoFacts.ts';
import { ensureProductCategorySchema, listProductCategories } from './productCategories.ts';

export type ProductBrowseFilters = {
  q?: string | null;
  brand?: string | null;
  type?: string | null;
  sort?: string | null;
  page?: number | null;
  pageSize?: number | null;
};

export type ProductBrowseSummary = {
  productId: string;
  brandName: string | null;
  productName: string;
  productType: string | null;
  canonicalProductType: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  netContents: string | null;
  verifiedBatchCount: number;
};

export type ProductBrowseCatalog = {
  products: ProductBrowseSummary[];
  totalProducts: number;
  matchingProducts: number;
  batchCount: number;
  brandCount: number;
  categoryCount: number;
  hasCannlytics: boolean;
  page: number;
  pageSize: number;
  pageCount: number;
  brands: string[];
  productCategories: Array<{ id: string; slug: string; name: string }>;
};

function ensureBrowseSchema() {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  ensureProductCategorySchema(db);
  return db;
}

function normalizedSearch(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function productSortSql(value: unknown) {
  switch (String(value || '').trim()) {
    case 'name-asc':
      return 'p.product_name COLLATE NOCASE ASC,p.brand_name COLLATE NOCASE ASC,p.id ASC';
    case 'name-desc':
      return 'p.product_name COLLATE NOCASE DESC,p.brand_name COLLATE NOCASE ASC,p.id ASC';
    case 'brand-asc':
      return "COALESCE(NULLIF(TRIM(p.brand_name),''),'zzzz') COLLATE NOCASE ASC,p.product_name COLLATE NOCASE ASC,p.id ASC";
    case 'recent':
      return 'latest_record DESC,p.product_name COLLATE NOCASE ASC,p.id ASC';
    case 'batches-desc':
      return 'verified_batch_count DESC,p.product_name COLLATE NOCASE ASC,p.id ASC';
    case 'category':
    default:
      return 'COALESCE(c.sort_order,999) ASC,c.name COLLATE NOCASE ASC,p.product_name COLLATE NOCASE ASC,p.brand_name COLLATE NOCASE ASC,latest_record DESC';
  }
}

export function getProductBrowseCatalog(filters: ProductBrowseFilters = {}): ProductBrowseCatalog {
  const db = ensureBrowseSchema();
  const q = normalizedSearch(filters.q);
  const brand = String(filters.brand || '').trim();
  const type = String(filters.type || '').trim();
  const pageSize = Math.max(12, Math.min(72, Math.floor(Number(filters.pageSize || 36)) || 36));
  const orderBy = productSortSql(filters.sort);

  const conditions = ['b.verified = 1'];
  const params: Array<string | number> = [];
  if (brand) {
    conditions.push('p.brand_name = ?');
    params.push(brand);
  }
  if (type) {
    conditions.push('(c.slug = ? OR c.name = ? COLLATE NOCASE OR p.product_type = ? COLLATE NOCASE)');
    params.push(type, type, type);
  }

  const searchExpression = `LOWER(
    COALESCE(p.product_name,'') || ' ' || COALESCE(p.brand_name,'') || ' ' ||
    COALESCE(c.name,'') || ' ' || COALESCE(p.product_type,'') || ' ' ||
    COALESCE(p.canonical_product_type,'') || ' ' || COALESCE(p.net_contents,'')
  )`;
  for (const token of q.split(/\s+/).filter(Boolean)) {
    conditions.push(`${searchExpression} LIKE ?`);
    params.push(`%${token}%`);
  }
  const where = conditions.join(' AND ');

  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT p.id) AS product_count,
      COUNT(DISTINCT b.id) AS batch_count,
      COUNT(DISTINCT CASE WHEN p.brand_name IS NOT NULL AND TRIM(p.brand_name) <> '' THEN p.brand_name END) AS brand_count,
      COUNT(DISTINCT CASE WHEN p.category_id IS NOT NULL THEN p.category_id END) AS category_count,
      MAX(CASE WHEN b.source_name = 'Cannlytics' THEN 1 ELSE 0 END) AS has_cannlytics
    FROM cannabis_products p
    JOIN cannabis_batches b ON b.product_id=p.id AND b.verified=1
  `).get() as any;

  const matched = db.prepare(`
    SELECT COUNT(DISTINCT p.id) AS count
    FROM cannabis_products p
    JOIN cannabis_batches b ON b.product_id=p.id
    LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
    WHERE ${where}
  `).get(...params) as any;
  const matchingProducts = Number(matched?.count || 0);
  const pageCount = Math.max(1, Math.ceil(matchingProducts / pageSize));
  const requestedPage = Math.max(1, Math.floor(Number(filters.page || 1)) || 1);
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;

  const rows = db.prepare(`
    SELECT
      p.id AS product_id,
      p.brand_name,
      p.product_name,
      p.product_type,
      p.canonical_product_type,
      p.category_id,
      c.name AS category_name,
      c.slug AS category_slug,
      p.net_contents,
      COUNT(DISTINCT b.id) AS verified_batch_count,
      MAX(COALESCE(b.tested_at,b.updated_at,b.created_at)) AS latest_record
    FROM cannabis_products p
    JOIN cannabis_batches b ON b.product_id=p.id
    LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
    WHERE ${where}
    GROUP BY p.id,p.brand_name,p.product_name,p.product_type,p.canonical_product_type,p.category_id,c.name,c.slug,p.net_contents
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as any[];

  const brandRows = db.prepare(`
    SELECT DISTINCT p.brand_name AS value
    FROM cannabis_products p
    WHERE p.brand_name IS NOT NULL AND TRIM(p.brand_name) <> ''
      AND EXISTS (SELECT 1 FROM cannabis_batches b WHERE b.product_id=p.id AND b.verified=1)
    ORDER BY value COLLATE NOCASE
  `).all() as Array<{ value: string }>;

  return {
    products: rows.map(row => ({
      productId: row.product_id,
      brandName: row.brand_name || null,
      productName: row.product_name,
      productType: row.product_type || null,
      canonicalProductType: row.canonical_product_type || null,
      categoryId: row.category_id || null,
      categoryName: row.category_name || null,
      categorySlug: row.category_slug || null,
      netContents: row.net_contents || null,
      verifiedBatchCount: Number(row.verified_batch_count || 0),
    })),
    totalProducts: Number(stats?.product_count || 0),
    matchingProducts,
    batchCount: Number(stats?.batch_count || 0),
    brandCount: Number(stats?.brand_count || 0),
    categoryCount: Number(stats?.category_count || 0),
    hasCannlytics: Boolean(stats?.has_cannlytics),
    page,
    pageSize,
    pageCount,
    brands: brandRows.map(row => String(row.value)),
    productCategories: listProductCategories(db).map(category => ({ id: category.id, slug: category.slug, name: category.name })),
  };
}
