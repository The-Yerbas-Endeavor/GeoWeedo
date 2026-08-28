import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate, type DispensaryCandidate } from '@/lib/candidateStore';

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ candidates: await listCandidates() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);

  if (Array.isArray(body?.ids)) {
    const ids = [...new Set(body.ids.map(String).filter(Boolean))].slice(0, 5000);
    const action = String(body.action || '');
    if (!ids.length) return NextResponse.json({ error: 'At least one candidate id is required.' }, { status: 400 });
    if (!['approve', 'reject'].includes(action)) return NextResponse.json({ error: 'Bulk action must be approve or reject.' }, { status: 400 });

    const all = await listCandidates();
    const selected = all.filter((item) => ids.includes(item.id));
    let updated = 0;
    let skipped = 0;
    const skippedReasons: Record<string, number> = {};

    for (const item of selected) {
      if (action === 'approve') {
        const hasCoordinates = Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
        const playableCoverage = item.imageryStatus === 'coverage';
        if (!hasCoordinates || !playableCoverage) {
          skipped++;
          const reason = !hasCoordinates ? 'missing_coordinates' : 'imagery_not_playable';
          skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
          continue;
        }
      }

      const result = await updateCandidate(item.id, { status: action === 'approve' ? 'approved' : 'rejected' });
      if (result) updated++;
    }

    return NextResponse.json({ action, requested: ids.length, matched: selected.length, updated, skipped, skippedReasons });
  }

  if (!body?.id) return NextResponse.json({ error: 'Candidate id is required.' }, { status: 400 });
  const patch: Partial<DispensaryCandidate> = {};
  if (['candidate', 'reviewing', 'approved', 'rejected'].includes(body.status)) patch.status = body.status as DispensaryCandidate['status'];
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.streetAddress !== undefined) patch.streetAddress = String(body.streetAddress).trim() || undefined;
  if (body.city !== undefined) patch.city = String(body.city).trim() || undefined;
  if (body.region !== undefined) patch.region = String(body.region).trim() || undefined;
  if (body.country !== undefined) patch.country = String(body.country).trim() || undefined;
  if (body.website !== undefined) patch.website = String(body.website).trim() || undefined;
  if (body.licenseNumber !== undefined) patch.licenseNumber = String(body.licenseNumber).trim() || undefined;
  if (body.sourceUrl !== undefined) patch.sourceUrl = String(body.sourceUrl).trim() || undefined;
  if (body.sourceLicense !== undefined) patch.sourceLicense = String(body.sourceLicense).trim() || undefined;
  if (body.latitude !== undefined && Number.isFinite(Number(body.latitude))) patch.latitude = Number(body.latitude);
  if (body.longitude !== undefined && Number.isFinite(Number(body.longitude))) patch.longitude = Number(body.longitude);
  const updated = await updateCandidate(String(body.id), patch);
  if (!updated) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });
  return NextResponse.json({ candidate: updated });
}
