import { NextRequest, NextResponse } from 'next/server';
import { gradeImagery } from '@/lib/imageryQuality';
import { getConfiguredImageryProvider, incrementImageryProviderUsage, type ImageryProvider as Provider } from '@/lib/imageryProviderSettings';

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

async function lookupGoogle(lat: number, lng: number) {
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!apiKey) throw new Error('Google Street View is selected but GOOGLE_MAPS_API_KEY is not configured.');

  const metadataUrl = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  metadataUrl.searchParams.set('location', `${lat},${lng}`);
  metadataUrl.searchParams.set('radius', '500');
  metadataUrl.searchParams.set('key', apiKey);
  incrementImageryProviderUsage('google', 'metadata');

  const response = await fetch(metadataUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Google Street View metadata returned ${response.status}`);
  const metadata = await response.json();
  if (metadata?.status !== 'OK' || !metadata?.pano_id || !metadata?.location) {
    return {
      provider: 'google' as const,
      photos: [],
      quality: gradeImagery(undefined, []),
      message: metadata?.status === 'ZERO_RESULTS' ? 'No Google Street View imagery found within 500 meters.' : `Google Street View lookup returned ${String(metadata?.status || 'UNKNOWN_ERROR')}.`,
      attribution: 'Google Street View',
    };
  }

  const panoId = String(metadata.pano_id);
  const panoLat = asNumber(metadata.location.lat) ?? lat;
  const panoLng = asNumber(metadata.location.lng) ?? lng;
  const headings = [0, 90, 180, 270];
  const photos = headings.map((heading, index) => ({
    id: `${panoId}-${heading}`,
    lat: panoLat,
    lng: panoLng,
    heading,
    fieldOfView: 90,
    projection: 'PERSPECTIVE',
    imageUrl: `/api/street-imagery/google-image?pano=${encodeURIComponent(panoId)}&heading=${heading}`,
    sequenceId: panoId,
    sequenceIndex: index,
    shotDate: metadata.date ?? null,
    width: 640,
    height: 640,
    qualityLevel: 1,
    qualityStatus: 'GOOGLE',
    status: 'GOOGLE',
  }));
  return { provider: 'google' as const, photos, initialIndex: 0, selectedPhotoId: photos[0]?.id ?? null, attribution: 'Google Street View', quality: gradeImagery(photos[0], photos) };
}

function selectedProvider(request: NextRequest): Provider {
  const requested = String(request.nextUrl.searchParams.get('provider') || '').trim().toLowerCase();
  if (requested === 'google' || requested === 'kartaview' || requested === 'auto') return requested;
  return getConfiguredImageryProvider();
}

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get('lat'));
  const lng = Number(request.nextUrl.searchParams.get('lng'));
  const approvedPhotoId = String(request.nextUrl.searchParams.get('photoId') || '').trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'Invalid latitude or longitude.' }, { status: 400 });
  }

  const provider = selectedProvider(request);
  try {
    if (provider === 'google') return NextResponse.json(await lookupGoogle(lat, lng));
    if (provider === 'kartaview') return NextResponse.json(await lookupKartaview(lat, lng, approvedPhotoId));
    try {
      const google = await lookupGoogle(lat, lng);
      if (google.photos.length) return NextResponse.json(google);
    } catch {}
    return NextResponse.json(await lookupKartaview(lat, lng, approvedPhotoId));
  } catch (error) {
    return NextResponse.json({ provider, error: error instanceof Error ? error.message : 'Street imagery lookup failed.' }, { status: 502 });
  }
}
