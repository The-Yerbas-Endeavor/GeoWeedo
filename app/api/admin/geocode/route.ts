import { NextRequest, NextResponse } from 'next/server';

function authorized(request: NextRequest) {
  const expected = process.env.GEOWEEDO_ADMIN_SECRET;
  return Boolean(expected) && request.headers.get('x-geoweedo-admin') === expected;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const q = String(request.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 5) return NextResponse.json({ error: 'Enter a complete address.' }, { status: 400 });

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GeoWeedo/0.3 (https://geoweedo.yerbas.org)',
        Referer: 'https://geoweedo.yerbas.org/',
      },
      next: { revalidate: 2592000 },
    });
    if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
    const data = await response.json();
    const results = Array.isArray(data) ? data.map((item: any) => ({
      displayName: String(item.display_name || ''),
      lat: Number(item.lat),
      lng: Number(item.lon),
      city: item.address?.city || item.address?.town || item.address?.village || item.address?.municipality || '',
      region: item.address?.state || item.address?.region || '',
      country: item.address?.country || '',
    })).filter((item: any) => Number.isFinite(item.lat) && Number.isFinite(item.lng)) : [];
    return NextResponse.json({ results, attribution: 'Geocoding © OpenStreetMap contributors' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Geocoding failed.' }, { status: 502 });
  }
}
