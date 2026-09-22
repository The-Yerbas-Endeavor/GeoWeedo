import { getDatabase } from './sqlite.ts';

export type ProductBrowseFilters = {
  q?: string | null;
  brand?: string | null;
  producer?: string | null;
  type?: string | null;
  sort?: string | null;
  page?: number | null;
  pageSize?: number | null;
  scope?: 'evidence' | 'all' | null;
};

export type ProductBrowseSummary = {
  productId: string;
  brandName: string | null;
  producerName: string | null;
  productName: string;
  productType: string | null;
  canonicalProductType: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  netContents: string | null;
  verifiedBatchCount: number;
  scanCount: number;
  approvedUploadCount: number;
  menuListingCount: number;
  latestEvidenceAt: string | null;
};

export type ProductBrowseCatalog = {
  products: ProductBrowseSummary[];
  totalProducts: number;
  allProducts: number;
  matchingProducts: number;
  scope: 'evidence' | 'all';
  scannedProducts: number;
  uploadedProducts: number;
  menuLinkedProducts: number;
  batchCount: number;
  brandCount: number;
  producerCount: number;
  categoryCount: number;
  hasCannlytics: boolean;
  page: number;
  pageSize: number;
  pageCount: number;
  brands: string[];
  producers: string[];
  productCategories: Array<{ id: string; slug: string; name: string }>;
};

type Db = ReturnType<typeof getDatabase>;

function normalizedSearch(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tableColumns(db: Db, table: string) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table);
  if (!exists) return new Set<string>();
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>)
      .map(row => String(row.name || ''))
      .filter(Boolean),
  );
}

function pageSizeFor(filters: ProductBrowseFilters) {
  return Math.max(12, Math.min(72, Math.floor(Number(filters.pageSize || 36)) || 36));
}

function emptyCatalog(filters: ProductBrowseFilters, pageSize = pageSizeFor(filters)): ProductBrowseCatalog {
  return {
    products: [],
    totalProducts: 0,
    allProducts: 0,
    matchingProducts: 0,
    scope: filters.scope === 'all' ? 'all' : 'evidence',
    scannedProducts: 0,
    uploadedProducts: 0,
    menuLinkedProducts: 0,
    batchCount: 0,
    brandCount: 0,
    producerCount: 0,
    categoryCount: 0,
    hasCannlytics: false,
    page: Math.max(1, Math.floor(Number(filters.page || 1)) || 1),
    pageSize,
    pageCount: 1,
    brands: [],
    producers: [],
    productCategories: [],
  };
}

function requireColumns(actual: Set<string>, required: string[], table: string) {
  const missing = required.filter(column => !actual.has(column));
  if (missing.length) throw new Error(`${table} is missing columns: ${missing.join(', ')}`);
}

function productSortSql(value: unknown, brandSql = 'p.brand_name', producerSql = 'NULL') {
  switch (String(value || '').trim()) {
    case 'name-asc': return `p.product_name COLLATE NOCASE ASC,${brandSql} COLLATE NOCASE ASC,p.id ASC`;
    case 'name-desc': return `p.product_name COLLATE NOCASE DESC,${brandSql} COLLATE NOCASE ASC,p.id ASC`;
    case 'brand-asc': return `COALESCE(NULLIF(TRIM(${brandSql}),''),'zzzz') COLLATE NOCASE ASC,p.product_name COLLATE NOCASE ASC,p.id ASC`;
    case 'producer-asc': return `COALESCE(NULLIF(TRIM(${producerSql}),''),'zzzz') COLLATE NOCASE ASC,p.product_name COLLATE NOCASE ASC,p.id ASC`;
    case 'recent': return 'latest_record DESC,p.product_name COLLATE NOCASE ASC,p.id ASC';
    case 'batches-desc': return 'verified_batch_count DESC,p.product_name COLLATE NOCASE ASC,p.id ASC';
    case 'category':
    default: return `COALESCE(c.sort_order,999) ASC,c.name COLLATE NOCASE ASC,p.product_name COLLATE NOCASE ASC,${brandSql} COLLATE NOCASE ASC,latest_record DESC`;
  }
}

function publicProductBrowseCatalog(filters: ProductBrowseFilters): ProductBrowseCatalog {
  // Default public browsing is evidence-driven (resolved scans + approved COA uploads).
  // The full reference catalog is also publicly browseable when the caller explicitly
  // selects scope='all'. This read path never creates/backfills schema.
  const db = getDatabase();
  const productColumns = tableColumns(db, 'cannabis_products');
  const batchColumns = tableColumns(db, 'cannabis_batches');
  const categoryColumns = tableColumns(db, 'cannabis_product_categories');
  const qrColumns = tableColumns(db, 'cannabis_qr_scans');
  const submissionColumns = tableColumns(db, 'cannabis_product_submissions');
  const uploadColumns = tableColumns(db, 'cannabis_coa_uploads');
  const menuItemColumns = tableColumns(db, 'dispensary_menu_items');
  const menuColumns = tableColumns(db, 'dispensary_menus');
  const dispensaryColumns = tableColumns(db, 'dispensaries');

  requireColumns(productColumns, ['id', 'product_name', 'brand_name', 'product_type', 'canonical_product_type', 'category_id', 'net_contents'], 'cannabis_products');
  requireColumns(batchColumns, ['id', 'product_id', 'verified', 'source_name', 'tested_at', 'updated_at', 'created_at'], 'cannabis_batches');
  requireColumns(categoryColumns, ['id', 'slug', 'name', 'sort_order', 'active'], 'cannabis_product_categories');

  const hasScans = qrColumns.has('product_id') && qrColumns.has('scan_count') && qrColumns.has('last_seen_at');
  const hasScanBrands = hasScans && qrColumns.has('brand_name');
  const scanBrandSql = hasScanBrands
    ? `(SELECT NULLIF(TRIM(qb.brand_name),'') FROM cannabis_qr_scans qb WHERE qb.product_id=p.id AND qb.brand_name IS NOT NULL AND TRIM(qb.brand_name)<>'' ORDER BY qb.last_seen_at DESC LIMIT 1)`
    : 'NULL';
  // Public brand filtering must use explicit source/scanner brand evidence only.
  // Product titles are too inconsistent to safely infer brands at browse time.
  const effectiveBrandSql = `COALESCE(NULLIF(TRIM(p.brand_name),''),${scanBrandSql})`;
  const effectiveProducerSql = `(
    SELECT NULLIF(TRIM(bp.producer_name),'')
    FROM cannabis_batches bp
    WHERE bp.product_id=p.id
      AND bp.producer_name IS NOT NULL
      AND TRIM(bp.producer_name)<>''
    ORDER BY bp.verified DESC, COALESCE(bp.tested_at,bp.updated_at,bp.created_at) DESC
    LIMIT 1
  )`;
  const hasApprovedUploads =
    submissionColumns.has('id') && submissionColumns.has('product_id') && submissionColumns.has('status') &&
    uploadColumns.has('submission_id') && uploadColumns.has('status');
  const hasMenus =
    menuItemColumns.has('id') && menuItemColumns.has('menu_id') && menuItemColumns.has('product_id') && menuItemColumns.has('active') &&
    menuColumns.has('id') && menuColumns.has('dispensary_id') && menuColumns.has('active') &&
    dispensaryColumns.has('id') && dispensaryColumns.has('active');
  const menuMatchVisibility = menuItemColumns.has('match_confidence')
    ? menuItemColumns.has('match_review_status')
      ? "AND NOT (mi.match_confidence='possible' AND COALESCE(mi.match_review_status,'pending') <> 'confirmed')"
      : "AND COALESCE(mi.match_confidence,'') <> 'possible'"
    : '';

  const scope: 'evidence' | 'all' = filters.scope === 'all' ? 'all' : 'evidence';
  const evidenceSelects: string[] = [];
  if (hasScans) evidenceSelects.push('SELECT product_id FROM cannabis_qr_scans WHERE product_id IS NOT NULL');
  if (hasApprovedUploads) {
    evidenceSelects.push(`SELECT s.product_id
      FROM cannabis_product_submissions s
      JOIN cannabis_coa_uploads cu ON cu.submission_id=s.id
      WHERE s.product_id IS NOT NULL AND s.status='approved' AND cu.status='approved'`);
  }
  if (scope === 'evidence' && !evidenceSelects.length) return emptyCatalog(filters);

  const publicCte = scope === 'all'
    ? 'WITH public_product_ids AS (SELECT id AS product_id FROM cannabis_products)'
    : `WITH public_product_ids AS (${evidenceSelects.join(' UNION ')})`;
  const q = normalizedSearch(filters.q);
  const brand = String(filters.brand || '').trim();
  const producer = String(filters.producer || '').trim();
  const type = String(filters.type || '').trim();
  const pageSize = pageSizeFor(filters);
  const orderBy = productSortSql(filters.sort, effectiveBrandSql, effectiveProducerSql);
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (brand) {
    conditions.push(`${effectiveBrandSql} = ? COLLATE NOCASE`);
    params.push(brand);
  }
  if (producer) {
    conditions.push(`${effectiveProducerSql} = ? COLLATE NOCASE`);
    params.push(producer);
  }
  if (type) {
    conditions.push('(c.slug = ? OR c.name = ? COLLATE NOCASE OR p.product_type = ? COLLATE NOCASE)');
    params.push(type, type, type);
  }

  const searchExpression = `LOWER(
    COALESCE(p.product_name,'') || ' ' || COALESCE(${effectiveBrandSql},'') || ' ' ||
    COALESCE(${effectiveProducerSql},'') || ' ' || COALESCE(c.name,'') || ' ' || COALESCE(p.product_type,'') || ' ' ||
    COALESCE(p.canonical_product_type,'') || ' ' || COALESCE(p.net_contents,'')
  )`;
  for (const token of q.split(/\s+/).filter(Boolean)) {
    conditions.push(`${searchExpression} LIKE ?`);
    params.push(`%${token}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const stats = db.prepare(`${publicCte}
    SELECT
      COUNT(DISTINCT p.id) AS product_count,
      COUNT(DISTINCT ${effectiveBrandSql}) AS brand_count,
      COUNT(DISTINCT ${effectiveProducerSql}) AS producer_count,
      COUNT(DISTINCT CASE WHEN p.category_id IS NOT NULL THEN p.category_id END) AS category_count
    FROM cannabis_products p
    JOIN public_product_ids public ON public.product_id=p.id
  `).get() as any;

  const batchStats = db.prepare(`${publicCte}
    SELECT
      COUNT(*) AS batch_count,
      MAX(CASE WHEN b.source_name='Cannlytics' THEN 1 ELSE 0 END) AS has_cannlytics
    FROM cannabis_batches b
    JOIN public_product_ids public ON public.product_id=b.product_id
    WHERE b.verified=1
  `).get() as any;

  const allProducts = Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_products').get() as any)?.n || 0);

  const scannedProducts = hasScans
    ? Number((db.prepare(`SELECT COUNT(DISTINCT product_id) AS n FROM cannabis_qr_scans WHERE product_id IS NOT NULL`).get() as any)?.n || 0)
    : 0;

  const uploadedProducts = hasApprovedUploads
    ? Number((db.prepare(`SELECT COUNT(DISTINCT s.product_id) AS n
        FROM cannabis_product_submissions s
        JOIN cannabis_coa_uploads cu ON cu.submission_id=s.id
        WHERE s.product_id IS NOT NULL AND s.status='approved' AND cu.status='approved'`).get() as any)?.n || 0)
    : 0;

  const menuLinkedProducts = hasMenus
    ? Number((db.prepare(`${publicCte}
        SELECT COUNT(DISTINCT mi.product_id) AS n
        FROM dispensary_menu_items mi
        JOIN dispensary_menus m ON m.id=mi.menu_id
        JOIN dispensaries d ON d.id=m.dispensary_id
        JOIN public_product_ids public ON public.product_id=mi.product_id
        WHERE mi.product_id IS NOT NULL AND mi.active=1 AND m.active=1 AND d.active=1
          ${menuMatchVisibility}`).get() as any)?.n || 0)
    : 0;

  const matched = db.prepare(`${publicCte}
    SELECT COUNT(DISTINCT p.id) AS count
    FROM cannabis_products p
    JOIN public_product_ids public ON public.product_id=p.id
    LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
    ${where}
  `).get(...params) as any;
  const matchingProducts = Number(matched?.count || 0);
  const pageCount = Math.max(1, Math.ceil(matchingProducts / pageSize));
  const requestedPage = Math.max(1, Math.floor(Number(filters.page || 1)) || 1);
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;

  const scanCountSql = hasScans
    ? '(SELECT COALESCE(SUM(q.scan_count),0) FROM cannabis_qr_scans q WHERE q.product_id=p.id)'
    : '0';
  const uploadCountSql = hasApprovedUploads
    ? `(SELECT COUNT(*)
         FROM cannabis_product_submissions s
         JOIN cannabis_coa_uploads cu ON cu.submission_id=s.id
         WHERE s.product_id=p.id AND s.status='approved' AND cu.status='approved')`
    : '0';
  const menuCountSql = hasMenus
    ? `(SELECT COUNT(DISTINCT mi.id)
         FROM dispensary_menu_items mi
         JOIN dispensary_menus m ON m.id=mi.menu_id
         JOIN dispensaries d ON d.id=m.dispensary_id
         WHERE mi.product_id=p.id AND mi.active=1 AND m.active=1 AND d.active=1
           ${menuMatchVisibility})`
    : '0';

  const evidenceDates: string[] = [];
  if (hasScans) evidenceDates.push("COALESCE((SELECT MAX(q.last_seen_at) FROM cannabis_qr_scans q WHERE q.product_id=p.id),'')");
  if (hasApprovedUploads) {
    const submissionDate = submissionColumns.has('reviewed_at')
      ? 'COALESCE(s.reviewed_at,s.updated_at,s.created_at)'
      : submissionColumns.has('updated_at')
        ? 'COALESCE(s.updated_at,s.created_at)'
        : 's.created_at';
    evidenceDates.push(`COALESCE((SELECT MAX(${submissionDate})
      FROM cannabis_product_submissions s
      JOIN cannabis_coa_uploads cu ON cu.submission_id=s.id
      WHERE s.product_id=p.id AND s.status='approved' AND cu.status='approved'),'')`);
  }
  const latestEvidenceSql = evidenceDates.length > 1 ? `MAX(${evidenceDates.join(',')})` : evidenceDates[0] || "''";

  const rows = db.prepare(`${publicCte}
    SELECT
      p.id AS product_id,
      ${effectiveBrandSql} AS brand_name,
      ${effectiveProducerSql} AS producer_name,
      p.product_name,
      p.product_type,
      p.canonical_product_type,
      p.category_id,
      c.name AS category_name,
      c.slug AS category_slug,
      p.net_contents,
      (SELECT COUNT(*) FROM cannabis_batches b WHERE b.product_id=p.id AND b.verified=1) AS verified_batch_count,
      ${scanCountSql} AS scan_count,
      ${uploadCountSql} AS approved_upload_count,
      ${menuCountSql} AS menu_listing_count,
      ${latestEvidenceSql} AS latest_record
    FROM cannabis_products p
    JOIN public_product_ids public ON public.product_id=p.id
    LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as any[];

  const brandRows = db.prepare(`${publicCte}
    SELECT DISTINCT ${effectiveBrandSql} AS value
    FROM cannabis_products p
    JOIN public_product_ids public ON public.product_id=p.id
    WHERE ${effectiveBrandSql} IS NOT NULL AND TRIM(${effectiveBrandSql}) <> ''
    ORDER BY value COLLATE NOCASE
  `).all() as Array<{ value: string }>;

  const producerRows = db.prepare(`${publicCte}
    SELECT DISTINCT ${effectiveProducerSql} AS value
    FROM cannabis_products p
    JOIN public_product_ids public ON public.product_id=p.id
    WHERE ${effectiveProducerSql} IS NOT NULL AND TRIM(${effectiveProducerSql}) <> ''
    ORDER BY value COLLATE NOCASE
  `).all() as Array<{ value: string }>;

  const categories = db.prepare(`${publicCte}
    SELECT DISTINCT c.id,c.slug,c.name,c.sort_order
    FROM cannabis_product_categories c
    JOIN cannabis_products p ON p.category_id=c.id
    JOIN public_product_ids public ON public.product_id=p.id
    WHERE c.active=1
    ORDER BY c.sort_order,c.name COLLATE NOCASE
  `).all() as Array<{ id: string; slug: string; name: string }>;

  return {
    products: rows.map(row => ({
      productId: String(row.product_id),
      brandName: row.brand_name || null,
      producerName: row.producer_name || null,
      productName: String(row.product_name),
      productType: row.product_type || null,
      canonicalProductType: row.canonical_product_type || null,
      categoryId: row.category_id || null,
      categoryName: row.category_name || null,
      categorySlug: row.category_slug || null,
      netContents: row.net_contents || null,
      verifiedBatchCount: Number(row.verified_batch_count || 0),
      scanCount: Number(row.scan_count || 0),
      approvedUploadCount: Number(row.approved_upload_count || 0),
      menuListingCount: Number(row.menu_listing_count || 0),
      latestEvidenceAt: row.latest_record || null,
    })),
    totalProducts: Number(stats?.product_count || 0),
    allProducts,
    matchingProducts,
    scope,
    scannedProducts,
    uploadedProducts,
    menuLinkedProducts,
    batchCount: Number(batchStats?.batch_count || 0),
    brandCount: Number(stats?.brand_count || 0),
    producerCount: Number(stats?.producer_count || 0),
    categoryCount: Number(stats?.category_count || 0),
    hasCannlytics: Boolean(batchStats?.has_cannlytics),
    page,
    pageSize,
    pageCount,
    brands: brandRows.map(row => String(row.value)),
    producers: producerRows.map(row => String(row.value)),
    productCategories: categories,
  };
}

export function getProductBrowseCatalog(filters: ProductBrowseFilters = {}): ProductBrowseCatalog {
  try {
    return publicProductBrowseCatalog(filters);
  } catch (error) {
    console.error('[productBrowse] public evidence catalog unavailable; returning empty catalog', error);
    return emptyCatalog(filters);
  }
}
