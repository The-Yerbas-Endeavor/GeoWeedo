import { NextRequest, NextResponse } from 'next/server';
import { importCandidates } from '@/lib/candidateStore';

export const runtime = 'nodejs';

function authorized(request: NextRequest) {
  const expected = process.env.GEOWEEDO_ADMIN_SECRET;
  return Boolean(expected) && request.headers.get('x-geoweedo-admin') === expected;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (body?.preset !== 'oregon-olcc') return NextResponse.json({ error: 'Unknown official-data preset.' }, { status: 400 });

  const sourceUrl = 'https://data.oregon.gov/Business/OLCC-Cannabis-Business-Licenses-Endorsements/q32u-cmam';
  const apiUrl = 'https://data.oregon.gov/resource/q32u-cmam.json?$limit=5000';
  try {
    const response = await fetch(apiUrl, { headers: { Accept: 'application/json', 'User-Agent': 'GeoWeedo/0.3 (https://geoweedo.yerbas.org)' }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Oregon Open Data returned ${response.status}`);
    const data = await response.json();
    const rows = (Array.isArray(data) ? data : []).filter((row: any) => String(row.license_type || '').toLowerCase().includes('retail') && !String(row.license_expired || '').toLowerCase().includes('yes')).map((row: any) => ({
      name: String(row.business_name || row.business_licenses || '').trim(),
      streetAddress: String(row.physical_address || '').trim() || undefined,
      city: undefined,
      region: 'Oregon',
      country: 'USA',
      latitude: undefined,
      longitude: undefined,
      website: undefined,
      licenseNumber: String(row.license_number || '').trim() || undefined,
      dataSource: 'Oregon OLCC Open Data',
      sourceUrl,
      sourceLicense: 'Official Oregon Open Data; verify current portal terms/metadata.',
    })).filter((row: any) => row.name);
    const result = await importCandidates(rows);
    return NextResponse.json({ ...result, fetched: rows.length, source: 'Oregon OLCC Cannabis Business Licenses & Endorsements' }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Official-data fetch failed.' }, { status: 502 });
  }
}
