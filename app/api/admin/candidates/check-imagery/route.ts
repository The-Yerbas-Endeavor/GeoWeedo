import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate } from '@/lib/candidateStore';
import { getDatabase } from '@/lib/sqlite';
import { lookupGameplayStreetView } from '@/lib/streetViewLookupClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasCoordinates(item: { latitude?: number; longitude?: number }) {
  return Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
}

function isOpenCandidateStatus(status?: string) {
  return status === 'candidate' || status === 'reviewing';
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
  const requestedPhotoId = String(body?.selectedPhotoId || '').trim();
  const source = body?.source === 'enrichment_approved' ? 'enrichment_approved' : 'coordinate_ready';
  const limit = Math.max(1, Math.min(Number(body?.limit) || 10, 50));
  const all = await listCandidates();

  const approvedByEnrichment = source === 'enrichment_approved' ? enrichmentApprovedIds() : null;
  const coordinateReady = all.filter((item) =>
    isOpenCandidateStatus(item.status) &&
    hasCoordinates(item) &&
    (!approvedByEnrichment || approvedByEnrichment.has(item.id))
  );
  const waiting = coordinateReady.filter(needsImageryCheck);

  const explicitAdminConfirmation = requestedIds.length > 0;
  const pool = explicitAdminConfirmation
    ? all.filter((item) => isOpenCandidateStatus(item.status) && hasCoordinates(item) && requestedIds.includes(item.id))
    : waiting;
  const selected = pool.slice(0, limit);

  if (explicitAdminConfirmation && !selected.length) {
    const requested = all.find((item) => requestedIds.includes(item.id));
    const detail = !requested
      ? 'The selected record no longer exists.'
      : !isOpenCandidateStatus(requested.status)
        ? `The selected record is ${requested.status}, not an open candidate.`
        : !hasCoordinates(requested)
          ? 'The selected candidate does not have valid coordinates.'
          : 'The selected candidate could not be checked for Street View.';
    return NextResponse.json({
      error: detail,
      source,
      checked: 0,
      results: [],
    }, { status: 409, headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }

  const results = [];

  for (const item of selected) {
    const checkedAt = new Date().toISOString();
    try {
      const result = await lookupGameplayStreetView(item.latitude as number, item.longitude as number, requestedPhotoId || undefined);
      const photos = Array.isArray(result.photos) ? result.photos : [];
      const defaultPhoto = photos[Math.max(0, Number(result.initialIndex || 0))] || photos[0];
      const selectedPhoto = requestedPhotoId ? photos.find((photo) => String(photo.id) === requestedPhotoId) : defaultPhoto;
      if (requestedPhotoId && !selectedPhoto) {
        throw new Error('The selected Street View image is no longer available at this location. Reload Street View and choose another image.');
      }
      const hasUsablePhoto = Boolean(selectedPhoto?.id && selectedPhoto?.imageUrl);
      const automaticPlayable = Boolean(result.quality?.playable && hasUsablePhoto);
      const adminSelected = Boolean(explicitAdminConfirmation && requestedPhotoId && hasUsablePhoto);
      const adminConfirmed = Boolean(explicitAdminConfirmation && hasUsablePhoto && !automaticPlayable);
      const playable = automaticPlayable || adminConfirmed || adminSelected;
      results.push(await updateCandidate(item.id, {
        imageryStatus: playable ? 'coverage' : 'no_coverage',
        imageryCount: photos.length,
        imageryCheckedAt: checkedAt,
        imageryMessage: adminSelected
          ? `ADMIN_SELECTED_STREET_VIEW · ${result.provider} · Admin selected and confirmed Street View image ${selectedPhoto?.id} for gameplay. Starting view ${selectedPhoto?.id}.`
          : automaticPlayable
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
    isOpenCandidateStatus(item.status) &&
    hasCoordinates(item) &&
    (!approvedAfter || approvedAfter.has(item.id))
  );
  const readyRemaining = inScope.filter(needsImageryCheck).length;
  const mappedCandidates = inScope.length;
  const missingCoordinates = refreshed.filter((item) => isOpenCandidateStatus(item.status) && !hasCoordinates(item)).length;

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
