import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
function text(value: unknown) { return String(value ?? '').trim(); }

const STATUSES = new Set(['all', 'resolved', 'review', 'ambiguous', 'missing']);
const SORTS: Record<string, string> = {
  batches_desc: 'r.distinct_batch_count DESC,r.evidence_count DESC,p.product_name COLLATE NOCASE ASC',
  evidence_desc: 'r.evidence_count DESC,r.distinct_batch_count DESC,p.product_name COLLATE NOCASE ASC',
  confidence_desc: 'COALESCE(r.confidence,-1) DESC,r.evidence_count DESC,p.product_name COLLATE NOCASE ASC',
  name_asc: 'p.product_name COLLATE NOCASE ASC,COALESCE(r.owner_name,\'\') COLLATE NOCASE ASC',
  name_desc: 'p.product_name COLLATE NOCASE DESC,COALESCE(r.owner_name,\'\') COLLATE NOCASE ASC',
  owner_asc: 'COALESCE(r.owner_name,\'\') COLLATE NOCASE ASC,p.product_name COLLATE NOCASE ASC',
};

function hasTable(db: ReturnType<typeof getDatabase>, name: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function readiness(db: ReturnType<typeof getDatabase>) {
  const resolution = hasTable(db, 'cannabis_product_owner_resolution');
  const evidence = hasTable(db, 'cannabis_product_owner_evidence');
  return { ready: resolution && evidence, resolution, evidence };
}

function summary(db: ReturnType<typeof getDatabase>) {
  const rows = db.prepare(`
    SELECT status,COUNT(*) AS n
    FROM cannabis_product_owner_resolution
    GROUP BY status
  `).all() as Array<{ status: string; n: number }>;
  const counts: Record<string, number> = { resolved: 0, review: 0, ambiguous: 0, missing: 0 };
  for (const row of rows) counts[row.status] = Number(row.n || 0);
  const evidenceRows = Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_product_owner_evidence').get() as any)?.n || 0);
  return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0), evidenceRows };
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const db = getDatabase();
  const state = readiness(db);
  if (!state.ready) {
    return NextResponse.json({ ...state, summary: null, products: [], total: 0, page: 1, pageSize: 25, pageCount: 1 }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const productId = text(request.nextUrl.searchParams.get('productId'));
  if (productId) {
    const product = db.prepare(`
      SELECT p.id AS product_id,p.brand_name,p.product_name,p.product_type,p.net_contents,
             r.status,r.owner_name,r.normalized_owner_name,r.owner_type,r.confidence,
             r.evidence_count,r.distinct_batch_count,r.candidate_count,r.resolver_version,r.updated_at,
             (SELECT GROUP_CONCAT(DISTINCT e.state_code) FROM cannabis_product_owner_evidence e WHERE e.product_id=r.product_id AND e.state_code IS NOT NULL) AS states
      FROM cannabis_product_owner_resolution r
      JOIN cannabis_products p ON p.id=r.product_id
      WHERE r.product_id=?
    `).get(productId) as any;
    if (!product) return NextResponse.json({ error: 'Owner-review product not found.' }, { status: 404 });

    const candidates = db.prepare(`
      SELECT owner_name,normalized_owner_name,owner_type,
             MAX(confidence) AS confidence,
             COUNT(*) AS evidence_count,
             COUNT(DISTINCT batch_id) AS batch_count,
             GROUP_CONCAT(DISTINCT evidence_field) AS evidence_fields,
             GROUP_CONCAT(DISTINCT state_code) AS states
      FROM cannabis_product_owner_evidence
      WHERE product_id=?
      GROUP BY normalized_owner_name,owner_type
      ORDER BY MAX(confidence) DESC,COUNT(*) DESC,owner_name COLLATE NOCASE ASC
      LIMIT 200
    `).all(productId);

    const evidence = db.prepare(`
      SELECT id,batch_id,state_code,owner_name,owner_type,evidence_field,evidence_source,confidence,source_external_id
      FROM cannabis_product_owner_evidence
      WHERE product_id=?
      ORDER BY confidence DESC,owner_name COLLATE NOCASE ASC,batch_id ASC
      LIMIT 500
    `).all(productId);

    return NextResponse.json({ ready: true, product, candidates, evidence }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const q = text(request.nextUrl.searchParams.get('q')).toLowerCase();
  const requestedStatus = text(request.nextUrl.searchParams.get('status')) || 'review';
  const status = STATUSES.has(requestedStatus) ? requestedStatus : 'review';
  const requestedPage = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get('page') || 1)) || 1);
  const pageSize = Math.max(10, Math.min(100, Math.floor(Number(request.nextUrl.searchParams.get('pageSize') || 25)) || 25));
  const sort = text(request.nextUrl.searchParams.get('sort')) || 'batches_desc';
  const orderBy = SORTS[sort] || SORTS.batches_desc;

  const where: string[] = [];
  const params: string[] = [];
  if (status !== 'all') { where.push('r.status=?'); params.push(status); }
  if (q) {
    where.push(`LOWER(p.product_name || ' ' || COALESCE(p.brand_name,'') || ' ' || COALESCE(r.owner_name,'') || ' ' || COALESCE(r.owner_type,'')) LIKE ?`);
    params.push(`%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = Number((db.prepare(`
    SELECT COUNT(*) AS n
    FROM cannabis_product_owner_resolution r
    JOIN cannabis_products p ON p.id=r.product_id
    ${whereSql}
  `).get(...params) as any)?.n || 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;

  const products = db.prepare(`
    SELECT p.id AS product_id,p.brand_name,p.product_name,p.product_type,p.net_contents,
           r.status,r.owner_name,r.owner_type,r.confidence,r.evidence_count,
           r.distinct_batch_count,r.candidate_count,r.updated_at,
           (SELECT GROUP_CONCAT(DISTINCT e.state_code) FROM cannabis_product_owner_evidence e WHERE e.product_id=r.product_id AND e.state_code IS NOT NULL) AS states
    FROM cannabis_product_owner_resolution r
    JOIN cannabis_products p ON p.id=r.product_id
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  return NextResponse.json({
    ready: true,
    summary: summary(db),
    products,
    total,
    page,
    pageSize,
    pageCount,
    status,
    sort,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
