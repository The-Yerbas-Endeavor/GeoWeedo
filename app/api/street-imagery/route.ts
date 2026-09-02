import { NextRequest, NextResponse } from 'next/server';
import { gradeImagery } from '@/lib/imageryQuality';
import { getConfiguredImageryProvider, incrementImageryProviderUsage, type ImageryProvider as Provider } from '@/lib/imageryProviderSettings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RawPhoto = Record<string, any>;

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radiusKm = 6371.0088;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function normalizePhoto(photo: RawPhoto) {
  const lat = asNumber(photo.lat ?? photo.matchLat);
  const lng = asNumber(photo.lng ?? photo.matchLng);
  const imageUrl = photo.fileurlProc || photo.fileurl || photo.fileurlLTh || photo.fileurlTh || null;
  if (lat === null || lng === null || !imageUrl) return null;
  return {
    id: String(photo.id ?? `${photo.sequenceId ?? 'photo'}-${photo.sequenceIndex ?? 0}`),
    lat,
    lng,
    heading: asNumber(photo.heading) ?? 0,
    fieldOfView: asNumber(photo.fieldOfView) ?? 0,
    projection: String(photo.projection ?? '').toUpperCase(),
    imageUrl: String(imageUrl),
    sequenceId: String(photo.sequenceId ?? photo.sequence?.id ?? ''),
    sequenceIndex: asNumber(photo.sequenceIndex) ?? 0,
    shotDate: photo.shotDate ?? photo.dateAdded ?? null,
    width: asNumber(photo.width) ?? 0,
    height: asNumber(photo.height) ?? 0,
    qualityLevel: asNumber(photo.qualityLevel) ?? 0,
    qualityStatus: String(photo.qualityStatus ?? ''),
    status: String(photo.status ?? ''),
  };
}

async function getKartaviewJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'GeoWeedo/1.0 (https://geoweedo.com)' },
    next: { revalidate: 86400 },
  });
  if (!response.ok) throw new Error(`KartaView returned ${response.status}`);
  return response.json();
}

async function getSequencePhotos(sequenceId: string) {
  const sequenceUrl = new URL('https://api.openstreetcam.org/2.0/photo/');
  sequenceUrl.searchParams.set('sequenceId', sequenceId);
  sequenceUrl.searchParams.set('page', '1');
  sequenceUrl.searchParams.set('itemsPerPage', '150');
  const sequenceJson = await getKartaviewJson(sequenceUrl.toString());
  const sequenceRaw = Array.isArray(sequenceJson?.result?.data) ? sequenceJson.result.data : [];
  return sequenceRaw.map(normalizePhoto).filter(Boolean) as NonNullable<ReturnType<typeof normalizePhoto>>[];
}

async function lookupKartaview(lat: number, lng: number, approvedPhotoId: string) {
  incrementImageryProviderUsage('kartaview', 'lookup');
  const origin = { lat, lng };
  let photos: NonNullable<ReturnType<typeof normalizePhoto>>[] = [];
  let target: NonNullable<ReturnType<typeof normalizePhoto>> | null = null;

  if (approvedPhotoId) {
    const detailJson = await getKartaviewJson(`https://api.openstreetcam.org/2.0/photo/${encodeURIComponent(approvedPhotoId)}`);
    const raw = detailJson?.result?.data;
    const detail = Array.isArray(raw) ? raw[0] : raw;
    target = detail ? normalizePhoto(detail) : null;
    if (target?.sequenceId) photos = await getSequencePhotos(target.sequenceId);
    if (target && !photos.length) photos = [target];
  }

  if (!photos.length) {
    const nearbyUrl = new URL('https://api.openstreetcam.org/2.0/photo/');
    nearbyUrl.searchParams.set('lat', String(lat));
    nearbyUrl.searchParams.set('lng', String(lng));
    nearbyUrl.searchParams.set('zoomLevel', '18');
    nearbyUrl.searchParams.set('join', 'sequence');
    nearbyUrl.searchParams.set('radius', '500');
    nearbyUrl.searchParams.set('orderBy', 'id');
    nearbyUrl.searchParams.set('orderDirection', 'desc');
    const nearbyJson = await getKartaviewJson(nearbyUrl.toString());
    const nearbyRaw = Array.isArray(nearbyJson?.result?.data) ? nearbyJson.result.data : [];
    const nearby = nearbyRaw.map(normalizePhoto).filter(Boolean) as NonNullable<ReturnType<typeof normalizePhoto>>[];
    if (!nearby.length) {
      return { provider: 'kartaview' as const, photos: [], quality: gradeImagery(undefined, []), message: 'No KartaView imagery found within 500 meters.', attribution: 'KartaView contributors' };
    }
    target = [...nearby].sort((a, b) => distanceKm(origin, a) - distanceKm(origin, b))[0];
    photos = target.sequenceId ? await getSequencePhotos(target.sequenceId) : nearby;
    if (!photos.length) photos = nearby;
  }

  photos.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  let targetIndex = target ? photos.findIndex((photo) => photo.id === target!.id) : -1;
  if (targetIndex < 0) targetIndex = photos.reduce((best, photo, index) => distanceKm(origin, photo) < distanceKm(origin, photos[best]) ? index : best, 0);
  const quality = gradeImagery(photos[targetIndex], photos);
  const start = Math.max(0, targetIndex - 12);
  const end = Math.min(photos.length, targetIndex + 13);
  const windowed = photos.slice(start, end);
  return { provider: 'kartaview' as const, photos: windowed, initialIndex: Math.max(0, targetIndex - start), selectedPhotoId: approvedPhotoId || target?.id || null, attribution: 'KartaView contributors', quality };
}

async function getGoogleMetadata(apiKey: string, params: { pano?: string; lat?: number; lng?: number }) {
  const metadataUrl = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  if (params.pano) metadataUrl.searchParams.set('pano', params.pano);
  else {
    metadataUrl.searchParams.set('location', `${params.lat},${params.lng}`);
    metadataUrl.searchParams.set('radius', '500');
  }
  metadataUrl.searchParams.set('key', apiKey);
  incrementImageryProviderUsage('google', 'metadata');
  const response = await fetch(metadataUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Google Street View metadata returned ${response.status}`);
  return response.json();
}

async function lookupGoogle(lat: number, lng: number, approvedPhotoId = '') {
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!apiKey) throw new Error('Google Street View is selected but GOOGLE_MAPS_API_KEY is not configured.');

  let metadata = await getGoogleMetadata(apiKey, approvedPhotoId ? { pano: approvedPhotoId } : { lat, lng });
  let recoveredFromStalePano = false;

  // Google panorama IDs can disappear or be replaced over time. A saved ID
  // should not strand a live game round: retry by the approved coordinates and
  // use Google's current nearest panorama when one is available.
  if (approvedPhotoId && (metadata?.status !== 'OK' || !metadata?.pano_id || !metadata?.location)) {
    metadata = await getGoogleMetadata(apiKey, { lat, lng });
    recoveredFromStalePano = metadata?.status === 'OK' && Boolean(metadata?.pano_id) && Boolean(metadata?.location);
  }

  if (metadata?.status !== 'OK' || !metadata?.pano_id || !metadata?.location) {
    return {
      provider: 'google' as const,
      photos: [],
      quality: gradeImagery(undefined, []),
      message: metadata?.status === 'ZERO_RESULTS'
        ? 'No Google Street View imagery found within 500 meters.'
        : `Google Street View lookup returned ${String(metadata?.status || 'UNKNOWN_ERROR')}.`,
      attribution: 'Google Street View',
    };
  }

  const panoId = String(metadata.pano_id);
  const panoLat = asNumber(metadata.location.lat) ?? lat;
  const panoLng = asNumber(metadata.location.lng) ?? lng;
  const panorama = {
    id: panoId,
    lat: panoLat,
    lng: panoLng,
    heading: 0,
    fieldOfView: 360,
    projection: 'GOOGLE_PANORAMA',
    imageUrl: `/api/street-imagery/google-image?pano=${encodeURIComponent(panoId)}&heading=0`,
    sequenceId: panoId,
    sequenceIndex: 0,
    shotDate: metadata.date ?? null,
    width: 640,
    height: 400,
    qualityLevel: 1,
    qualityStatus: recoveredFromStalePano ? 'GOOGLE_360_RECOVERED' : 'GOOGLE_360',
    status: recoveredFromStalePano ? 'GOOGLE_360_RECOVERED' : 'GOOGLE_360',
  };
  return {
    provider: 'google' as const,
    photos: [panorama],
    initialIndex: 0,
    selectedPhotoId: panoId,
    recoveredFromStalePano,
    attribution: 'Google Street View',
    quality: gradeImagery(panorama, [panorama]),
  };
}

function selectedProvider(request: NextRequest): Provider {
  const requested = String(request.nextUrl.searchParams.get('provider') || '').trim().toLowerCase();
  if (requested === 'google' || requested === 'kartaview' || requested === 'auto') return requested;
  return getConfiguredImageryProvider();
}

function json(data: unknown, configuredProvider: Provider, actualProvider?: string, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-GeoWeedo-Configured-Provider': configuredProvider,
      'X-GeoWeedo-Imagery-Provider': actualProvider || configuredProvider,
    },
  });
}

export async function GET(request: NextRequest) {
  const latRaw = request.nextUrl.searchParams.get('lat');
  const lngRaw = request.nextUrl.searchParams.get('lng');
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  const approvedPhotoId = String(request.nextUrl.searchParams.get('photoId') || '').trim();
  const provider = selectedProvider(request);

  if (latRaw === null || lngRaw === null || !latRaw.trim() || !lngRaw.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return json({ error: 'Invalid latitude or longitude.' }, provider, provider, 400);
  }

  try {
    if (provider === 'google') {
      const result = await lookupGoogle(lat, lng, approvedPhotoId);
      return json(result, provider, result.provider);
    }
    if (provider === 'kartaview') {
      const result = await lookupKartaview(lat, lng, approvedPhotoId);
      return json(result, provider, result.provider);
    }
    try {
      const google = await lookupGoogle(lat, lng, approvedPhotoId);
      if (google.photos.length) return json(google, provider, google.provider);
    } catch {}
    const fallback = await lookupKartaview(lat, lng, approvedPhotoId);
    return json(fallback, provider, fallback.provider);
  } catch (error) {
    return json({ provider, error: error instanceof Error ? error.message : 'Street imagery lookup failed.' }, provider, provider, 502);
  }
}
