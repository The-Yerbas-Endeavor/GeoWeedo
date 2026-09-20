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

function distanceMeters(a:{lat:number;lng:number},b:{lat:number;lng:number}){
  const radius=6371008.8,toRad=(value:number)=>value*Math.PI/180;
  const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng),lat1=toRad(a.lat),lat2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return radius*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

function isOpenCandidateStatus(status?: string) {
  return status === 'candidate' || status === 'reviewing';
}

function needsImageryCheck(item: { imageryStatus?: string }) {
  return !item.imageryStatus || item.imageryStatus === 'unchecked' || item.imageryStatus === 'error' || item.imageryStatus === 'missing_coordinates';
}

async function mapWithConcurrency<T,R>(items:T[],concurrency:number,worker:(item:T,index:number)=>Promise<R>){
  const results=new Array<R>(items.length);
  let next=0;
  async function run(){
    while(true){
      const index=next++;
      if(index>=items.length)return;
      results[index]=await worker(items[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),items.length)},()=>run()));
  return results;
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

async function handlePost(request: NextRequest) {
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

  const lookupResults = await mapWithConcurrency(selected, 3, async (item) => {
    const checkedAt = new Date().toISOString();

    const alreadyAdminConfirmed =
      explicitAdminConfirmation &&
      !requestedPhotoId &&
      item.imageryStatus === 'coverage' &&
      /^ADMIN_(?:SELECTED|CONFIRMED)_STREET_VIEW/.test(String(item.imageryMessage || ''));

    if (alreadyAdminConfirmed) {
      return { item, patch: null as null | Partial<typeof item> };
    }

    try {
      const result = await lookupGameplayStreetView(item.latitude as number, item.longitude as number, requestedPhotoId || undefined);
      const photos = Array.isArray(result.photos) ? result.photos : [];
      const defaultPhoto = photos[Math.max(0, Number(result.initialIndex || 0))] || photos[0];
      const exactSelectedPhoto = requestedPhotoId ? photos.find((photo) => String(photo.id) === requestedPhotoId) : undefined;
      const refreshedSelectedPhoto = Boolean(
        requestedPhotoId &&
        !exactSelectedPhoto &&
        result.provider === 'google' &&
        result.recoveredFromStalePano &&
        defaultPhoto
      );
      const selectedPhoto = exactSelectedPhoto || (refreshedSelectedPhoto ? defaultPhoto : requestedPhotoId ? undefined : defaultPhoto);

      if (requestedPhotoId && !selectedPhoto) {
        throw new Error('The selected Street View image is no longer available at this location. Reload Street View and choose another image.');
      }

      const replacementDistanceMeters = refreshedSelectedPhoto && selectedPhoto
        ? distanceMeters(
            {lat:item.latitude as number,lng:item.longitude as number},
            {lat:Number(selectedPhoto.lat),lng:Number(selectedPhoto.lng)}
          )
        : 0;

      if (refreshedSelectedPhoto && replacementDistanceMeters > 100) {
        throw new Error(`Google replaced the selected panorama, but the replacement is ${Math.round(replacementDistanceMeters)} m from the dispensary. Choose a closer Street View image.`);
      }
      if (refreshedSelectedPhoto && !result.quality?.playable) {
        throw new Error('Google replaced the selected panorama, but the replacement does not pass gameplay quality checks.');
      }

      const hasUsablePhoto = Boolean(selectedPhoto?.id && selectedPhoto?.imageUrl);
      const automaticPlayable = Boolean(result.quality?.playable && hasUsablePhoto);
      const adminSelected = Boolean(explicitAdminConfirmation && requestedPhotoId && exactSelectedPhoto && hasUsablePhoto);
      const adminConfirmed = Boolean(explicitAdminConfirmation && hasUsablePhoto && !automaticPlayable);
      const playable = automaticPlayable || adminConfirmed || adminSelected;
      return {
        item,
        patch: {
          imageryStatus: playable ? 'coverage' as const : 'no_coverage' as const,
          imageryCount: photos.length,
          imageryCheckedAt: checkedAt,
          imageryMessage: refreshedSelectedPhoto
            ? `ADMIN_CONFIRMED_STREET_VIEW · google · Selected panorama ${requestedPhotoId} was stale; refreshed to ${selectedPhoto?.id} · ${Math.round(replacementDistanceMeters)} m from location. Starting view ${selectedPhoto?.id}.`
            : adminSelected
              ? `ADMIN_SELECTED_STREET_VIEW · ${result.provider} · Admin selected and confirmed Street View image ${selectedPhoto?.id} for gameplay. Starting view ${selectedPhoto?.id}.`
              : automaticPlayable
                ? `Street View · ${result.provider} · Grade ${result.quality?.grade || 'A'}: ${result.quality?.reason || 'Gameplay-ready imagery.'}${selectedPhoto?.id ? ` Starting view ${selectedPhoto.id}.` : ''}`
                : adminConfirmed
                  ? `ADMIN_CONFIRMED_STREET_VIEW · ${result.provider} · Admin confirmed Street View readiness from State location manager.${selectedPhoto?.id ? ` Starting view ${selectedPhoto.id}.` : ''}`
                  : `Not gameplay quality: ${result.quality?.reason || result.message || 'No playable Street View imagery found.'}`,
        },
      };
    } catch (error) {
      return {
        item,
        patch: {
          imageryStatus: 'error' as const,
          imageryCount: 0,
          imageryCheckedAt: checkedAt,
          imageryMessage: error instanceof Error ? error.message : 'Street View quality lookup failed.',
        },
      };
    }
  });

  const results = [];
  for (const outcome of lookupResults) {
    if (!outcome.patch) {
      results.push(outcome.item);
      continue;
    }
    try {
      const updated = await updateCandidate(outcome.item.id, outcome.patch);
      if (updated) results.push(updated);
    } catch (error) {
      const fallback = await updateCandidate(outcome.item.id, {
        imageryStatus: 'error',
        imageryCount: 0,
        imageryCheckedAt: new Date().toISOString(),
        imageryMessage: error instanceof Error ? `Candidate update failed: ${error.message}` : 'Candidate update failed.',
      }).catch(() => null);
      if (fallback) results.push(fallback);
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


export async function POST(request: NextRequest) {
  try {
    return await handlePost(request);
  } catch (error) {
    console.error('[check-imagery] fatal pipeline error', error);
    return NextResponse.json({
      error: error instanceof Error ? `Gameplay imagery pipeline failed: ${error.message}` : 'Gameplay imagery pipeline failed unexpectedly.',
      checked: 0,
      results: [],
    }, { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }
}
