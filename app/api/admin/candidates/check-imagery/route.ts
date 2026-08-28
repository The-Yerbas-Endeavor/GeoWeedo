import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate } from '@/lib/candidateStore';

export const runtime = 'nodejs';

async function checkCoverage(lat: number, lng: number) {
  const url = new URL('https://api.openstreetcam.org/2.0/photo/');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('zoomLevel', '18');
  url.searchParams.set('join', 'sequence');
  url.searchParams.set('orderBy', 'id');
  url.searchParams.set('orderDirection', 'desc');
  url.searchParams.set('radius', '500');
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'GeoWeedo/0.4 (https://geoweedo.yerbas.org)' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`KartaView returned ${response.status}`);
  const json = await response.json();
  const rows = Array.isArray(json?.result?.data) ? json.result.data : Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  return rows.filter((row: any) => row && (row.fileurlProc || row.fileurl || row.fileurlLTh || row.fileurlTh)).length;
}

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const requestedIds = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  const limit = Math.max(1, Math.min(Number(body?.limit) || 10, 10));
  const all = await listCandidates();
  const pool = requestedIds.length ? all.filter((item) => requestedIds.includes(item.id)) : all.filter((item) => item.status === 'candidate' && (!item.imageryStatus || item.imageryStatus === 'unchecked' || item.imageryStatus === 'error'));
  const selected = pool.slice(0, limit);
  const results = [];

  for (const item of selected) {
    const checkedAt = new Date().toISOString();
    if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
      const updated = await updateCandidate(item.id, { imageryStatus: 'missing_coordinates', imageryCount: 0, imageryCheckedAt: checkedAt, imageryMessage: 'Coordinates required before KartaView coverage can be checked.' });
      results.push(updated);
      continue;
    }
    try {
      const count = await checkCoverage(item.latitude as number, item.longitude as number);
      const updated = await updateCandidate(item.id, {
        imageryStatus: count > 0 ? 'coverage' : 'no_coverage',
        imageryCount: count,
        imageryCheckedAt: checkedAt,
        imageryMessage: count > 0 ? `${count} nearby KartaView image(s) found.` : 'No nearby KartaView imagery found within the current search radius.',
      });
      results.push(updated);
    } catch (error) {
      const updated = await updateCandidate(item.id, { imageryStatus: 'error', imageryCount: 0, imageryCheckedAt: checkedAt, imageryMessage: error instanceof Error ? error.message : 'Imagery lookup failed.' });
      results.push(updated);
    }
  }

  return NextResponse.json({ checked: results.length, results }, { headers: { 'Cache-Control': 'no-store' } });
}
