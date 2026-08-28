import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate } from '@/lib/candidateStore';
import { gradeImagery } from '@/lib/imageryQuality';

export const runtime = 'nodejs';

function num(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function normalize(row: any) {
  return {
    id: String(row?.id || ''),
    projection: String(row?.projection || ''),
    fieldOfView: num(row?.fieldOfView),
    width: num(row?.width),
    height: num(row?.height),
    status: String(row?.status || ''),
    sequenceId: String(row?.sequenceId || row?.sequence?.id || ''),
  };
}

async function checkCoverage(lat: number, lng: number) {
  const headers = { Accept: 'application/json', 'User-Agent': 'GeoWeedo/0.6 (https://geoweedo.yerbas.org)' };
  const url = new URL('https://api.openstreetcam.org/2.0/photo/');
  url.searchParams.set('lat', String(lat)); url.searchParams.set('lng', String(lng)); url.searchParams.set('zoomLevel', '18');
  url.searchParams.set('join', 'sequence'); url.searchParams.set('orderBy', 'id'); url.searchParams.set('orderDirection', 'desc'); url.searchParams.set('radius', '500');
  const response = await fetch(url, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`KartaView returned ${response.status}`);
  const json = await response.json();
  const raw = Array.isArray(json?.result?.data) ? json.result.data : [];
  if (!raw.length) return { count: 0, quality: gradeImagery(undefined, []) };

  for (const candidate of raw.slice(0, 8)) {
    const selected = normalize(candidate);
    let sequence = [selected];
    if (selected.sequenceId) {
      const sequenceUrl = new URL('https://api.openstreetcam.org/2.0/photo/');
      sequenceUrl.searchParams.set('sequenceId', selected.sequenceId); sequenceUrl.searchParams.set('page', '1'); sequenceUrl.searchParams.set('itemsPerPage', '150');
      const sequenceResponse = await fetch(sequenceUrl, { headers, cache: 'no-store' });
      if (sequenceResponse.ok) {
        const sequenceJson = await sequenceResponse.json();
        const rows = Array.isArray(sequenceJson?.result?.data) ? sequenceJson.result.data : [];
        sequence = rows.map(normalize);
      }
    }
    const quality = gradeImagery(selected, sequence);
    if (quality.playable) return { count: sequence.length, quality };
  }

  const first = normalize(raw[0]);
  let sequence = [first];
  if (first.sequenceId) {
    const sequenceUrl = new URL('https://api.openstreetcam.org/2.0/photo/');
    sequenceUrl.searchParams.set('sequenceId', first.sequenceId); sequenceUrl.searchParams.set('page', '1'); sequenceUrl.searchParams.set('itemsPerPage', '150');
    const sequenceResponse = await fetch(sequenceUrl, { headers, cache: 'no-store' });
    if (sequenceResponse.ok) {
      const sequenceJson = await sequenceResponse.json();
      const rows = Array.isArray(sequenceJson?.result?.data) ? sequenceJson.result.data : [];
      sequence = rows.map(normalize);
    }
  }
  return { count: sequence.length, quality: gradeImagery(first, sequence) };
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
      results.push(await updateCandidate(item.id, { imageryStatus: 'missing_coordinates', imageryCount: 0, imageryCheckedAt: checkedAt, imageryMessage: 'Coordinates required before KartaView quality can be checked.' }));
      continue;
    }
    try {
      const result = await checkCoverage(item.latitude as number, item.longitude as number);
      results.push(await updateCandidate(item.id, {
        imageryStatus: result.quality.playable ? 'coverage' : 'no_coverage',
        imageryCount: result.count,
        imageryCheckedAt: checkedAt,
        imageryMessage: result.quality.playable ? `Grade ${result.quality.grade}: ${result.quality.reason}` : `Not gameplay quality: ${result.quality.reason}`,
      }));
    } catch (error) {
      results.push(await updateCandidate(item.id, { imageryStatus: 'error', imageryCount: 0, imageryCheckedAt: checkedAt, imageryMessage: error instanceof Error ? error.message : 'Imagery quality lookup failed.' }));
    }
  }

  return NextResponse.json({ checked: results.length, results }, { headers: { 'Cache-Control': 'no-store' } });
}
