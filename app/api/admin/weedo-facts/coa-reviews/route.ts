import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { ensureWeedoFactsUploadSchema } from '@/lib/weedoFactsUploads';
import { approveExactBatchFromCoa, getAdminCoaReviewSubmissions, updateCoaReviewStatus } from '@/lib/weedoFactsReview';
import { getWeedoFactsReviewMatchPreview } from '@/lib/weedoFactsMatchPreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  ensureWeedoFactsUploadSchema();
  const status = request.nextUrl.searchParams.get('status') || 'pending';
  const submissions = getAdminCoaReviewSubmissions(status).map((submission: any) => ({ ...submission, matchPreview: getWeedoFactsReviewMatchPreview(submission) }));
  return NextResponse.json({ submissions }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  ensureWeedoFactsUploadSchema();
  const body = await request.json().catch(() => null);
  const submissionId = String(body?.submissionId || '').trim();
  const action = String(body?.action || '').trim();
  const reviewNotes = typeof body?.reviewNotes === 'string' ? body.reviewNotes.trim().slice(0, 2000) : null;
  if (!submissionId || !['approve_exact_batch', 'reject', 'needs_info'].includes(action)) return NextResponse.json({ error: 'submissionId and a valid action are required.' }, { status: 400 });

  try {
    if (action === 'approve_exact_batch') {
      const result = await approveExactBatchFromCoa({ submissionId, adminId: admin.id, reviewNotes });
      const lookupUrl = `/api/weedo-facts/lookup?identifier=${encodeURIComponent(String(result.identifier || ''))}&type=${encodeURIComponent(result.identifierType)}`;
      return NextResponse.json({ ok: true, status: 'approved', ...result, lookupUrl });
    }
    const result = updateCoaReviewStatus({ submissionId, adminId: admin.id, status: action === 'reject' ? 'rejected' : 'needs_info', reviewNotes });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[admin/weedo-facts/coa-reviews]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to review COA submission.' }, { status: 400 });
  }
}
