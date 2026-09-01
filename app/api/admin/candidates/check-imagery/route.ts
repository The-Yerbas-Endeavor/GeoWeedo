import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate } from '@/lib/candidateStore';
import { getDatabase } from '@/lib/sqlite';
import { lookupConfiguredStreetView } from '@/lib/streetViewLookupClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasCoordinates(item: { latitude?: number; longitude?: number }) {
  return Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
}

function needsImageryCheck(item: { imageryStatus?: string }) {
  return !item.imageryStatus || item.imageryStatus === 'unchecked' || item.imageryStatus === 'error' || item.imageryStatus === 'missing_coordinates';
}

function enrichmentApprovedIds() {
  const db = getDatabase();
  try {
    const rows = db.prepare(`
      SELECT location_id
      FROM google_places_enrichment
      WHERE confidence='high'
    `).all() as { location_id: string }[];
    return new Set(rows.map((row) => String(row.location_id)));
  } catch {
    return new Set<string>();
  }
}

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const requestedIds = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  const source = body?.source === 'enrichment_approved' ? 'enrichment_approved' : 'coordinate_ready';
  const limit = Math.max(1, Math.min(Number(body?.limit) || 10, 50));
  const all = await listCandidates();

  const approvedByEnrichment = source === 'enrichment_approved' ? enrichmentApprovedIds() : null;
  const coordinateReady = all.filter((item) =>
    item.status === 'candidate' &&
    hasCoordinates(item) &&
    (!approvedByEnrichment || approvedByEnrichment.has(item.id))
  );
  const waiting = coordinateReady.filter(needsImageryCheck);
  const pool = requestedIds.length
    ? waiting.filter((item) => requestedIds.includes(item.id))
    : waiting;
  const selected = pool.slice(0, limit);
  const results = [];

  for (const item of selected) {
    const checkedAt = new Date().toISOString();
    try {
      const result = await lookupConfiguredStreetView(item.latitude as number, item.longitude as number);
      const selectedPhoto = result.photos?.[Math.max(0, Number(result.initialIndex || 0))] || result.photos?.[0];
      const playable = Boolean(result.quality?.playable && selectedPhoto?.id && selectedPhoto?.imageUrl);
      results.push(await updateCandidate(item.id, {
        imageryStatus: playable ? 'coverage' : 'no_coverage',
        imageryCount: Array.isArray(result.photos) ? result.photos.length : 0,
        imageryCheckedAt: checkedAt,
        imageryMessage: playable
          ? `Street View · ${result.provider} · Grade ${result.quality?.grade || 'A'}: ${result.quality?.reason || 'Gameplay-ready imagery.'}${selectedPhoto?.id ? ` Starting view ${selectedPhoto.id}.` : ''}`
          : `Not gameplay quality: ${result.quality?.reason || result.message || 'No playable Street View imagery found.'}`,
      }));
    } catch (error) {
      results.push(await updateCandidate(item.id, {
        imageryStatus: 'error', imageryCount: 0, imageryCheckedAt: checkedAt,
        imageryMessage: error instanceof Error ? error.message : 'Street View quality lookup failed.',
      }));
    }
  }

  const refreshed = await listCandidates();
  const approvedAfter = source === 'enrichment_approved' ? enrichmentApprovedIds() : null;
  const inScope = refreshed.filter((item) =>
    item.status === 'candidate' &&
    hasCoordinates(item) &&
    (!approvedAfter || approvedAfter.has(item.id))
  );
  const readyRemaining = inScope.filter(needsImageryCheck).length;
  const mappedCandidates = inScope.length;
  const missingCoordinates = refreshed.filter((item) => item.status === 'candidate' && !hasCoordinates(item)).length;

  return NextResponse.json({
    source,
    checked: results.length,
    results,
    stats: {
      mappedCandidates,
      readyRemaining,
      missingCoordinates,
    },
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
