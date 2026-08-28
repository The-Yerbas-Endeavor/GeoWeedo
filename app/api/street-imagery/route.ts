import { NextRequest, NextResponse } from 'next/server';
import { gradeImagery } from '@/lib/imageryQuality';

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

async function getJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'GeoWeedo/0.6 (https://geoweedo.yerbas.org)' },
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
  const sequenceJson = await getJson(sequenceUrl.toString());
  const sequenceRaw = Array.isArray(sequenceJson?.result?.data) ? sequenceJson.result.data : [];
  return sequenceRaw.map(normalizePhoto).filter(Boolean) as NonNullable<ReturnType<typeof normalizePhoto>>[];
}

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get('lat'));
  const lng = Number(request.nextUrl.searchParams.get('lng'));
  const approvedPhotoId = String(request.nextUrl.searchParams.get('photoId') || '').trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'Invalid latitude or longitude.' }, { status: 400 });
  }
  try {
    const origin = { lat, lng };
    let photos: NonNullable<ReturnType<typeof normalizePhoto>>[] = [];
    let target: NonNullable<ReturnType<typeof normalizePhoto>> | null = null;
    if (approvedPhotoId) {
      const detailJson = await getJson(`https://api.openstreetcam.org/2.0/photo/${encodeURIComponent(approvedPhotoId)}`);
      const raw = detailJson?.result?.data;
      const detail = Array.isArray(raw) ? raw[0] : raw;
      target = detail ? normalizePhoto(detail) : null;
      if (target?.sequenceId) photos = await getSequencePhotos(target.sequenceId);
      if (target && !photos.length) photos = [target];
    }
    if (!photos.length) {
      const nearbyUrl = new URL('https://api.openstreetcam.org/2.0/photo/');
      nearbyUrl.searchParams.set('lat', String(lat)); nearbyUrl.searchParams.set('lng', String(lng)); nearbyUrl.searchParams.set('zoomLevel', '18');
      nearbyUrl.searchParams.set('join', 'sequence'); nearbyUrl.searchParams.set('radius', '500'); nearbyUrl.searchParams.set('orderBy', 'id'); nearbyUrl.searchParams.set('orderDirection', 'desc');
      const nearbyJson = await getJson(nearbyUrl.toString());
      const nearbyRaw = Array.isArray(nearbyJson?.result?.data) ? nearbyJson.result.data : [];
      const nearby = nearbyRaw.map(normalizePhoto).filter(Boolean) as NonNullable<ReturnType<typeof normalizePhoto>>[];
      if (!nearby.length) return NextResponse.json({ provider: 'kartaview', photos: [], quality: gradeImagery(undefined, []), message: 'No KartaView imagery found within 500 meters.' });
      target = [...nearby].sort((a, b) => distanceKm(origin, a) - distanceKm(origin, b))[0];
      photos = target.sequenceId ? await getSequencePhotos(target.sequenceId) : nearby;
      if (!photos.length) photos = nearby;
    }
    photos.sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    let targetIndex = target ? photos.findIndex((photo) => photo.id === target!.id) : -1;
    if (targetIndex < 0) targetIndex = photos.reduce((best, photo, index) => distanceKm(origin, photo) < distanceKm(origin, photos[best]) ? index : best, 0);
    const quality = gradeImagery(photos[targetIndex], photos);
    const start = Math.max(0, targetIndex - 12), end = Math.min(photos.length, targetIndex + 13);
    const windowed = photos.slice(start, end);
    return NextResponse.json({ provider: 'kartaview', photos: windowed, initialIndex: Math.max(0, targetIndex - start), selectedPhotoId: approvedPhotoId || target?.id || null, attribution: 'KartaView contributors', quality });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'KartaView imagery lookup failed.' }, { status: 502 });
  }
}
