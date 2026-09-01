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
    const ids = new Set<string>();
    try {
      const rows = db.prepare(`
        SELECT DISTINCT location_id
        FROM dispensary_batch_items
        WHERE record_type='candidate' AND status='applied'
      `).all() as { location_id: string }[];
      for (const row of rows) ids.add(String(row.location_id));
    } catch {}
    try {
      const rows = db.prepare(`
        SELECT location_id
        FROM google_places_enrichment
        WHERE confidence='high'
      `).all() as { location_id: string }[];
      for (const row of rows) ids.add(String(row.location_id));
    } catch {}
    return ids;
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

  // Explicit IDs come from an admin clicking Enable gameplay in State location manager.
  // Do not re-filter those IDs through a second enrichment table: the manager has
  // already established that the record is enriched. This request is the admin's
  // explicit Street View readiness check/confirmation.
  const explicitAdminConfirmation = requestedIds.length > 0;
  const pool = explicitAdminConfirmation
    ? all.filter((item) => item.status === 'candidate' && hasCoordinates(item) && requestedIds.includes(item.id))
    : waiting;
  const selected = pool.slice(0, limit);

  if (explicitAdminConfirmation && !selected.length) {
    return NextResponse.json({
      error: 'The selected candidate could not be checked for Street View. Confirm that it is still a candidate and has valid coordinates.',
      source,
      checked: 0,
      results: [],
    }, { status: 409, headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }

  const results = [];

  for (const item of selected) {
    const checkedAt = new Date().toISOString();
    try {
      const result = await lookupConfiguredStreetView(item.latitude as number, item.longitude as number);
      const selectedPhoto = result.photos?.[Math.max(0, Number(result.initialIndex || 0))] || result.photos?.[0];
      const hasUsablePhoto = Boolean(selectedPhoto?.id && selectedPhoto?.imageUrl);
      const automaticPlayable = Boolean(result.quality?.playable && hasUsablePhoto);
      const adminConfirmed = Boolean(explicitAdminConfirmation && hasUsablePhoto && !automaticPlayable);
      const playable = automaticPlayable || adminConfirmed;
      results.push(await updateCandidate(item.id, {
        imageryStatus: playable ? 'coverage' : 'no_coverage',
        imageryCount: Array.isArray(result.photos) ? result.photos.length : 0,
        imageryCheckedAt: checkedAt,
        imageryMessage: automaticPlayable
          ? `Street View · ${result.provider} · Grade ${result.quality?.grade || 'A'}: ${result.quality?.reason || 'Gameplay-ready imagery.'}${selectedPhoto?.id ? ` Starting view ${selectedPhoto.id}.` : ''}`
          : adminConfirmed
            ? `ADMIN_CONFIRMED_STREET_VIEW · ${result.provider} · Admin confirmed Street View readiness from State location manager.${selectedPhoto?.id ? ` Starting view ${selectedPhoto.id}.` : ''}`
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
