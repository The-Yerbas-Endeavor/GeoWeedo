import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate } from '@/lib/candidateStore';
import { inspectKartaViewCoverage } from '@/lib/kartaViewCoverage';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const requestedIds = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  const limit = Math.max(1, Math.min(Number(body?.limit) || 10, 10));
  const all = await listCandidates();
  const pool = requestedIds.length
    ? all.filter((item) => requestedIds.includes(item.id))
    : all.filter((item) => item.status === 'candidate' && (!item.imageryStatus || item.imageryStatus === 'unchecked' || item.imageryStatus === 'error' || item.imageryStatus === 'missing_coordinates'));
  const selected = pool.slice(0, limit);
  const results = [];

  for (const item of selected) {
    const checkedAt = new Date().toISOString();
    if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
      results.push(await updateCandidate(item.id, {
        imageryStatus: 'missing_coordinates', imageryCount: 0, imageryCheckedAt: checkedAt,
        imageryMessage: 'Coordinates required before KartaView quality can be checked.',
      }));
      continue;
    }

    try {
      const result = await inspectKartaViewCoverage(item.latitude as number, item.longitude as number);
      const selectedPhoto = result.selected;
      results.push(await updateCandidate(item.id, {
        imageryStatus: result.quality.playable ? 'coverage' : 'no_coverage',
        imageryCount: result.count,
        imageryCheckedAt: checkedAt,
        imageryMessage: result.quality.playable
          ? `Grade ${result.quality.grade}: ${result.quality.reason}${selectedPhoto?.id ? ` Starting frame ${selectedPhoto.id}.` : ''}`
          : `Not gameplay quality: ${result.quality.reason}`,
      }));
    } catch (error) {
      results.push(await updateCandidate(item.id, {
        imageryStatus: 'error', imageryCount: 0, imageryCheckedAt: checkedAt,
        imageryMessage: error instanceof Error ? error.message : 'Imagery quality lookup failed.',
      }));
    }
  }

  return NextResponse.json({ checked: results.length, results }, { headers: { 'Cache-Control': 'no-store' } });
}
