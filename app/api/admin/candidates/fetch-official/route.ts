import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { importCandidates } from '@/lib/candidateStore';

export const runtime = 'nodejs';

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { values.push(value.trim()); value = ''; }
    else value += char;
  }
  values.push(value.trim());
  return values;
}

function key(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function pick(row: Record<string, string>, names: string[]) {
  for (const name of names) if (row[name] !== undefined && row[name] !== '') return row[name];
  return '';
}
function coord(value: unknown) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function readiness(latitude?: number, longitude?: number) {
  return latitude !== undefined && longitude !== undefined ? 'unchecked' as const : 'missing_coordinates' as const;
}

async function fetchOregon() {
  const sourceUrl = 'https://data.oregon.gov/Business/OLCC-Cannabis-Business-Licenses-Endorsements/q32u-cmam';
  const apiUrl = 'https://data.oregon.gov/resource/q32u-cmam.json?$limit=5000';
  const response = await fetch(apiUrl, { headers: { Accept: 'application/json', 'User-Agent': 'GeoWeedo/0.4 (https://geoweedo.yerbas.org)' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Oregon Open Data returned ${response.status}`);
  const data = await response.json();
  return (Array.isArray(data) ? data : [])
    .filter((row: any) => String(row.license_type || '').toLowerCase().includes('retail') && !String(row.license_expired || '').toLowerCase().includes('yes'))
    .map((row: any) => {
      const latitude = coord(row.latitude);
      const longitude = coord(row.longitude);
      return {
        name: String(row.business_name || row.business_licenses || '').trim(),
        streetAddress: String(row.physical_address || '').trim() || undefined,
        city: undefined,
        region: 'Oregon',
        country: 'USA',
        latitude,
        longitude,
        website: undefined,
        licenseNumber: String(row.license_number || '').trim() || undefined,
        dataSource: 'Oregon OLCC Open Data',
        sourceUrl,
        sourceLicense: 'Official Oregon Open Data; verify current portal terms/metadata.',
        imageryStatus: readiness(latitude, longitude),
      };
    })
    .filter((row: any) => row.name);
}

async function fetchNevada() {
  const sourceUrl = 'https://ccb.nv.gov/list-of-licensees/';
  const response = await fetch(sourceUrl, { headers: { Accept: 'text/html', 'User-Agent': 'GeoWeedo/0.4 (https://geoweedo.yerbas.org)' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Nevada CCB returned ${response.status}`);
  const html = await response.text();
  const plain = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const rows: any[] = [];
  const regex = /([A-Z0-9][A-Z0-9 '&.!/()-]{2,80})\s*[–-]\s*([^|]{5,120}?)\s*[–-]\s*(Adult Use|Medical Only)\s*\|?\s*(\d{15,25})/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(plain)) !== null) {
    const name = match[1].trim().replace(/^Y\s+|^N\s+/i, '');
    const streetAddress = match[2].trim();
    const licenseNumber = match[4].trim();
    if (!name || !streetAddress || rows.some((row) => row.licenseNumber === licenseNumber)) continue;
    rows.push({
      name,
      streetAddress,
      city: undefined,
      region: 'Nevada',
      country: 'USA',
      latitude: undefined,
      longitude: undefined,
      website: undefined,
      licenseNumber,
      dataSource: 'Nevada CCB Licensed Retail Locations',
      sourceUrl,
      sourceLicense: 'Official Nevada Cannabis Compliance Board public retail-location list.',
      imageryStatus: 'missing_coordinates' as const,
    });
  }
  if (!rows.length) throw new Error('Nevada CCB page format changed; no retail rows could be parsed.');
  return rows;
}

async function fetchWashington() {
  const sourceUrl = 'https://data.wa.gov/d/brpd-b6zd';
  const apiUrl = 'https://data.wa.gov/api/v3/views/brpd-b6zd/export.csv?accessType=DOWNLOAD';
  const response = await fetch(apiUrl, { headers: { Accept: 'text/csv', 'User-Agent': 'GeoWeedo/0.4 (https://geoweedo.yerbas.org)' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Washington Open Data returned ${response.status}`);
  const text = await response.text();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(key);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line); const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = values[index] || ''; });
    const type = pick(row, ['licensetype','privilege','endorsement','license']);
    const name = pick(row, ['tradename','businessname','applicantname','licenseename','name']);
    const streetAddress = pick(row, ['address','streetaddress','premiseaddress','locationaddress']);
    const city = pick(row, ['city','premisecity','locationcity']);
    const region = pick(row, ['state','region']) || 'Washington';
    const licenseNumber = pick(row, ['licensenumber','licenseid','license']) || undefined;
    const latitude = coord(pick(row, ['latitude','lat']));
    const longitude = coord(pick(row, ['longitude','lng','lon','long']));
    return {
      name,
      streetAddress: streetAddress || undefined,
      city: city || undefined,
      region,
      country: 'USA',
      latitude,
      longitude,
      website: undefined,
      licenseNumber,
      dataSource: 'Washington LCB Cannabis Renewal Open Data',
      sourceUrl,
      sourceLicense: 'Public data.wa.gov LCB Cannabis Renewal dataset; license not specified in catalog.',
      imageryStatus: readiness(latitude, longitude),
      _type: type,
    };
  }).filter((row) => row.name && (!row._type || /cannabis|marijuana|retail/i.test(row._type)));
  return rows.map(({ _type, ...row }) => row);
}

const officialSources = [
  { preset: 'oregon-olcc', label: 'Oregon OLCC', fetcher: fetchOregon },
  { preset: 'nevada-ccb', label: 'Nevada CCB', fetcher: fetchNevada },
  { preset: 'washington-lcb', label: 'Washington LCB', fetcher: fetchWashington },
] as const;

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const preset = String(body?.preset || '');

  try {
    if (preset === 'all') {
      const settled = await Promise.allSettled(officialSources.map(async (source) => {
        const rows = await source.fetcher();
        const result = await importCandidates(rows as any[]);
        const geocoded = rows.filter((row: any) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude)).length;
        return { source: source.label, fetched: rows.length, added: result.added, geocoded, total: result.total };
      }));

      const details = settled.map((result, index) => result.status === 'fulfilled'
        ? { ok: true, ...result.value }
        : { ok: false, source: officialSources[index].label, fetched: 0, added: 0, geocoded: 0, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });

      const successful = details.filter((detail) => detail.ok);
      const failed = details.filter((detail) => !detail.ok);
      const added = successful.reduce((sum, detail) => sum + detail.added, 0);
      const fetched = successful.reduce((sum, detail) => sum + detail.fetched, 0);
      const geocoded = successful.reduce((sum, detail) => sum + detail.geocoded, 0);
      const total = successful.reduce((max, detail: any) => Math.max(max, detail.total || 0), 0);

      return NextResponse.json({ added, fetched, geocoded, total, details, failed: failed.length, source: 'Official state sync' }, { status: failed.length === officialSources.length ? 502 : 201 });
    }

    const source = officialSources.find((item) => item.preset === preset);
    if (!source) return NextResponse.json({ error: 'Unknown official-data preset.' }, { status: 400 });

    const rows = await source.fetcher();
    const result = await importCandidates(rows as any[]);
    const geocoded = rows.filter((row: any) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude)).length;
    return NextResponse.json({ ...result, fetched: rows.length, geocoded, source: source.label }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Official-data fetch failed.' }, { status: 502 });
  }
}
