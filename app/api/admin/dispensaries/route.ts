import { NextRequest, NextResponse } from 'next/server';
import { readApprovedDispensaries, saveApprovedDispensary, setDispensaryActive } from '@/lib/dispensaryStore';

function authorized(request: NextRequest) {
  const expected = process.env.GEOWEEDO_ADMIN_SECRET;
  if (!expected) return false;
  return request.headers.get('x-geoweedo-admin') === expected;
}

function invalid(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ dispensaries: await readApprovedDispensaries() });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return invalid('Invalid JSON body.');

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const imageryLatitude = Number(body.imageryLatitude);
  const imageryLongitude = Number(body.imageryLongitude);

  if (!String(body.name || '').trim()) return invalid('Name is required.');
  if (!String(body.city || '').trim()) return invalid('City is required.');
  if (!String(body.region || '').trim()) return invalid('Region is required.');
  if (!String(body.country || '').trim()) return invalid('Country is required.');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return invalid('Valid dispensary coordinates are required.');
  if (!String(body.imageryPhotoId || '').trim() || !String(body.imageryUrl || '').trim()) return invalid('A validated starting image is required.');
  if (!Number.isFinite(imageryLatitude) || !Number.isFinite(imageryLongitude)) return invalid('Valid imagery coordinates are required.');

  const slug = String(body.slug || body.name).trim();
  const saved = await saveApprovedDispensary({
    name: String(body.name).trim(),
    slug,
    streetAddress: String(body.streetAddress || '').trim() || undefined,
    city: String(body.city).trim(),
    region: String(body.region).trim(),
    country: String(body.country).trim(),
    latitude,
    longitude,
    website: String(body.website || '').trim() || undefined,
    dataSource: String(body.dataSource || 'manual').trim() || 'manual',
    sourceUrl: String(body.sourceUrl || '').trim() || undefined,
    sourceLicense: String(body.sourceLicense || '').trim() || undefined,
    recreational: Boolean(body.recreational),
    medical: Boolean(body.medical),
    imageryProvider: body.imageryProvider === 'geoweedo' ? 'geoweedo' : 'kartaview',
    imageryPhotoId: String(body.imageryPhotoId),
    imagerySequenceId: String(body.imagerySequenceId || '').trim() || undefined,
    imageryLatitude,
    imageryLongitude,
    imageryHeading: Number.isFinite(Number(body.imageryHeading)) ? Number(body.imageryHeading) : undefined,
    imageryFieldOfView: Number.isFinite(Number(body.imageryFieldOfView)) ? Number(body.imageryFieldOfView) : undefined,
    imageryProjection: String(body.imageryProjection || '').trim() || undefined,
    imageryUrl: String(body.imageryUrl),
    priorityWeight: Number.isFinite(Number(body.priorityWeight)) ? Math.max(0, Math.floor(Number(body.priorityWeight))) : undefined,
    sponsoredUntil: String(body.sponsoredUntil || '').trim() || undefined,
    active: body.active !== false,
  });

  return NextResponse.json({ dispensary: saved }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.id || typeof body.active !== 'boolean') return invalid('id and active are required.');
  const updated = await setDispensaryActive(String(body.id), body.active);
  if (!updated) return NextResponse.json({ error: 'Dispensary not found.' }, { status: 404 });
  return NextResponse.json({ dispensary: updated });
}
