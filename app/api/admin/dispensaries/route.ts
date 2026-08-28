import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { readApprovedDispensaries, saveApprovedDispensary, setDispensaryActive } from '@/lib/dispensaryStore';
import { gradeImagery } from '@/lib/imageryQuality';

function invalid(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }
function num(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }

async function validateKartaView(photoId: string) {
  const headers = { Accept: 'application/json', 'User-Agent': 'GeoWeedo/0.6 (https://geoweedo.yerbas.org)' };
  const detailResponse = await fetch(`https://api.openstreetcam.org/2.0/photo/${encodeURIComponent(photoId)}`, { headers, cache: 'no-store' });
  if (!detailResponse.ok) throw new Error(`KartaView photo validation returned ${detailResponse.status}`);
  const detailJson = await detailResponse.json();
  const rawDetail = Array.isArray(detailJson?.result?.data) ? detailJson.result.data[0] : detailJson?.result?.data;
  if (!rawDetail) throw new Error('KartaView photo could not be verified.');
  const selected = { id: String(rawDetail.id || photoId), projection: String(rawDetail.projection || ''), fieldOfView: num(rawDetail.fieldOfView), width: num(rawDetail.width), height: num(rawDetail.height), status: String(rawDetail.status || ''), sequenceId: String(rawDetail.sequenceId || rawDetail.sequence?.id || '') };
  let sequence = [selected];
  if (selected.sequenceId) {
    const url = new URL('https://api.openstreetcam.org/2.0/photo/');
    url.searchParams.set('sequenceId', selected.sequenceId); url.searchParams.set('page', '1'); url.searchParams.set('itemsPerPage', '150');
    const sequenceResponse = await fetch(url, { headers, cache: 'no-store' });
    if (!sequenceResponse.ok) throw new Error(`KartaView sequence validation returned ${sequenceResponse.status}`);
    const sequenceJson = await sequenceResponse.json();
    const rows = Array.isArray(sequenceJson?.result?.data) ? sequenceJson.result.data : [];
    sequence = rows.map((row: any) => ({ id: String(row.id || ''), projection: String(row.projection || ''), fieldOfView: num(row.fieldOfView), width: num(row.width), height: num(row.height), status: String(row.status || ''), sequenceId: String(row.sequenceId || row.sequence?.id || '') }));
  }
  return gradeImagery(selected, sequence);
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ dispensaries: await readApprovedDispensaries() });
}

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body) return invalid('Invalid JSON body.');
  const latitude = Number(body.latitude), longitude = Number(body.longitude), imageryLatitude = Number(body.imageryLatitude), imageryLongitude = Number(body.imageryLongitude);
  if (!String(body.name || '').trim()) return invalid('Name is required.');
  if (!String(body.city || '').trim()) return invalid('City is required.');
  if (!String(body.region || '').trim()) return invalid('Region is required.');
  if (!String(body.country || '').trim()) return invalid('Country is required.');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return invalid('Valid dispensary coordinates are required.');
  if (!String(body.imageryPhotoId || '').trim() || !String(body.imageryUrl || '').trim()) return invalid('A validated starting image is required.');
  if (!Number.isFinite(imageryLatitude) || !Number.isFinite(imageryLongitude)) return invalid('Valid imagery coordinates are required.');

  const imageryProvider = body.imageryProvider === 'geoweedo' ? 'geoweedo' : 'kartaview';
  if (imageryProvider === 'kartaview') {
    try {
      const quality = await validateKartaView(String(body.imageryPhotoId));
      if (!quality.playable) return invalid(`KartaView imagery rejected for gameplay: ${quality.reason}`);
    } catch (error) {
      return invalid(error instanceof Error ? error.message : 'KartaView imagery could not be quality-verified.');
    }
  } else {
    const projection = String(body.imageryProjection || '').toUpperCase();
    const fov = num(body.imageryFieldOfView);
    if (projection !== 'SPHERE' && projection !== 'EQUIRECTANGULAR' && fov < 300) {
      return invalid('GeoWeedo-hosted gameplay imagery must be a true 360° / equirectangular panorama. Flat one-off images are not playable.');
    }
  }

  const saved = await saveApprovedDispensary({
    name: String(body.name).trim(), slug: String(body.slug || body.name).trim(), streetAddress: String(body.streetAddress || '').trim() || undefined,
    city: String(body.city).trim(), region: String(body.region).trim(), country: String(body.country).trim(), latitude, longitude,
    website: String(body.website || '').trim() || undefined, dataSource: String(body.dataSource || 'manual').trim() || 'manual', sourceUrl: String(body.sourceUrl || '').trim() || undefined,
    sourceLicense: String(body.sourceLicense || '').trim() || undefined, recreational: Boolean(body.recreational), medical: Boolean(body.medical), imageryProvider,
    imageryPhotoId: String(body.imageryPhotoId), imagerySequenceId: String(body.imagerySequenceId || '').trim() || undefined, imageryLatitude, imageryLongitude,
    imageryHeading: Number.isFinite(Number(body.imageryHeading)) ? Number(body.imageryHeading) : undefined,
    imageryFieldOfView: Number.isFinite(Number(body.imageryFieldOfView)) ? Number(body.imageryFieldOfView) : undefined,
    imageryProjection: String(body.imageryProjection || '').trim() || undefined, imageryUrl: String(body.imageryUrl),
    priorityWeight: Number.isFinite(Number(body.priorityWeight)) ? Math.max(0, Math.floor(Number(body.priorityWeight))) : undefined,
    sponsoredUntil: String(body.sponsoredUntil || '').trim() || undefined, active: body.active !== false,
  });
  return NextResponse.json({ dispensary: saved }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.id || typeof body.active !== 'boolean') return invalid('id and active are required.');
  const updated = await setDispensaryActive(String(body.id), body.active);
  if (!updated) return NextResponse.json({ error: 'Dispensary not found.' }, { status: 404 });
  return NextResponse.json({ dispensary: updated });
}
