import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { ensureWeedoMenuSchema, addDispensaryMenuItem } from '@/lib/weedoMenus';
import { createWeedoFactsProduct } from '@/lib/weedoFacts';

export const runtime = 'nodejs';

function parseMenuItem(value: unknown) {
  if (!value || typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  ensureWeedoMenuSchema();
  const db = getDatabase();
  const status = request.nextUrl.searchParams.get('status') || 'pending';
  const submissions = db.prepare(`
    SELECT s.*, u.username, u.display_name AS submitter_display_name,
           d.name AS dispensary_name, d.city AS dispensary_city, d.region AS dispensary_region
      FROM cannabis_product_submissions s
      JOIN users u ON u.id = s.submitted_by_user_id
      LEFT JOIN dispensaries d ON d.id = s.dispensary_id
     WHERE (? = 'all' OR s.status = ?)
     ORDER BY s.created_at ASC
     LIMIT 250
  `).all(status, status) as any[];

  return NextResponse.json({ submissions: submissions.map(s => ({
    ...s,
    requested_menu_add: Boolean(s.requested_menu_add),
    menu_item: parseMenuItem(s.menu_item_json),
  })) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  ensureWeedoMenuSchema();
  const db = getDatabase();
  const body = await request.json().catch(() => null);
  const submissionId = String(body?.submissionId || '');
  const action = String(body?.action || '');
  if (!submissionId || !['approve', 'reject', 'needs_info'].includes(action)) {
    return NextResponse.json({ error: 'submissionId and a valid action are required.' }, { status: 400 });
  }

  const submission = db.prepare('SELECT * FROM cannabis_product_submissions WHERE id = ?').get(submissionId) as any;
  if (!submission) return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
  if (submission.status !== 'pending' && action === 'approve') {
    return NextResponse.json({ error: `Submission is already ${submission.status}.` }, { status: 409 });
  }

  const now = new Date().toISOString();
  const reviewNotes = typeof body?.reviewNotes === 'string' ? body.reviewNotes.trim().slice(0, 2000) : null;

  if (action !== 'approve') {
    const nextStatus = action === 'reject' ? 'rejected' : 'needs_info';
    db.prepare(`UPDATE cannabis_product_submissions SET status=?, reviewed_by_admin_id=?, reviewed_at=?, review_notes=?, updated_at=? WHERE id=?`)
      .run(nextStatus, admin.id, now, reviewNotes, now, submissionId);
    return NextResponse.json({ ok: true, status: nextStatus });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    let productId = submission.product_id as string | null;
    if (!productId) {
      if (!submission.product_name) throw new Error('Product name is required before approval.');
      productId = createWeedoFactsProduct({
        brandName: submission.brand_name,
        productName: submission.product_name,
        productType: submission.product_type,
        netContents: submission.net_contents,
      });
    }

    const existingIdentifier = db.prepare(`SELECT id FROM cannabis_product_identifiers WHERE identifier_type=? AND identifier_value=? LIMIT 1`)
      .get(submission.identifier_type, submission.identifier_value) as any;
    if (!existingIdentifier && ['upc', 'qr'].includes(submission.identifier_type)) {
      db.prepare(`INSERT INTO cannabis_product_identifiers (id, product_id, identifier_type, identifier_value, source, verified, created_at)
                  VALUES (?, ?, ?, ?, 'community_admin_review', 1, ?)`)
        .run(`cpid-${randomUUID()}`, productId, submission.identifier_type, submission.identifier_value, now);
    }

    let batchId = submission.batch_id as string | null;
    const hasBatchIdentity = Boolean(submission.batch_number || submission.uid || ['uid', 'batch', 'coa'].includes(submission.identifier_type));
    if (!batchId && hasBatchIdentity) {
      batchId = `batch-${randomUUID()}`;
      db.prepare(`INSERT INTO cannabis_batches (
        id, product_id, batch_number, uid, coa_number, coa_url, source_type, source_name, source_url, verified, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'community_submission', 'GeoWeedo community', ?, 0, ?, ?)`)
        .run(batchId, productId, submission.batch_number || (submission.identifier_type === 'batch' ? submission.identifier_value : null), submission.uid || (submission.identifier_type === 'uid' ? submission.identifier_value : null), submission.identifier_type === 'coa' ? submission.identifier_value : null, submission.coa_url || null, submission.source_url || submission.coa_url || null, now, now);

      if (['uid', 'batch', 'coa', 'qr'].includes(submission.identifier_type)) {
        db.prepare(`INSERT OR IGNORE INTO cannabis_batch_identifiers (id, batch_id, identifier_type, identifier_value, verified, created_at)
                    VALUES (?, ?, ?, ?, 0, ?)`)
          .run(`cbid-${randomUUID()}`, batchId, submission.identifier_type, submission.identifier_value, now);
      }
    }

    let menuItemId: string | null = null;
    const menu = parseMenuItem(submission.menu_item_json);
    if (submission.requested_menu_add && submission.dispensary_id && menu) {
      menuItemId = addDispensaryMenuItem({
        dispensaryId: submission.dispensary_id,
        productId,
        batchId,
        itemName: menu.itemName || submission.product_name || 'Cannabis product',
        brandName: submission.brand_name || null,
        category: menu.category || submission.product_type || null,
        variant: menu.variant || null,
        packageSize: menu.packageSize || submission.net_contents || null,
        priceCents: Number.isFinite(Number(menu.priceCents)) ? Number(menu.priceCents) : null,
        currency: menu.currency || 'USD',
        inventoryStatus: 'reported',
        sourceType: 'community_submission',
        sourceUrl: submission.source_url || null,
        verified: true,
      });
    }

    db.prepare(`UPDATE cannabis_product_submissions
                   SET product_id=?, batch_id=?, status='approved', reviewed_by_admin_id=?, reviewed_at=?, review_notes=?, updated_at=?
                 WHERE id=?`)
      .run(productId, batchId, admin.id, now, reviewNotes, now, submissionId);

    db.prepare(`INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
                VALUES (?, 'admin', ?, 'weedo_facts.submission_approved', 'cannabis_product_submission', ?, ?, ?)`)
      .run(`audit-${randomUUID()}`, admin.id, submissionId, JSON.stringify({ productId, batchId, menuItemId }), now);

    db.exec('COMMIT');
    return NextResponse.json({ ok: true, status: 'approved', productId, batchId, menuItemId });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('[admin/weedo-facts/submissions]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to approve submission.' }, { status: 400 });
  }
}
