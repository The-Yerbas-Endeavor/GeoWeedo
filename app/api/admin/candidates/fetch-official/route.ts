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

async function fetchOregon() {
  const sourceUrl = 'https://data.oregon.gov/Business/OLCC-Cannabis-Business-Licenses-Endorsements/q32u-cmam';
  const apiUrl = 'https://data.oregon.gov/resource/q32u-cmam.json?$limit=5000';
  const response = await fetch(apiUrl, { headers: { Accept: 'application/json', 'User-Agent': 'GeoWeedo/0.4 (https://geoweedo.yerbas.org)' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Oregon Open Data returned ${response.status}`);
  const data = await response.json();
  return (Array.isArray(data) ? data : []).filter((row: any) => String(row.license_type || '').toLowerCase().includes('retail') && !String(row.license_expired || '').toLowerCase().includes('yes')).map((row: any) => ({
    name: String(row.business_name || row.business_licenses || '').trim(),
    streetAddress: String(row.physical_address || '').trim() || undefined,
    city: undefined, region: 'Oregon', country: 'USA', latitude: undefined, longitude: undefined, website: undefined,
    licenseNumber: String(row.license_number || '').trim() || undefined,
    dataSource: 'Oregon OLCC Open Data', sourceUrl,
    sourceLicense: 'Official Oregon Open Data; verify current portal terms/metadata.',
  })).filter((row: any) => row.name);
}

async function fetchNevada() {
  const sourceUrl = 'https://ccb.nv.gov/list-of-licensees/';
  const response = await fetch(sourceUrl, { headers: { Accept: 'text/html', 'User-Agent': 'GeoWeedo/0.4 (https://geoweedo.yerbas.org)' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Nevada CCB returned ${response.status}`);
  const html = await response.text();
  const plain = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const rows: any[] = [];
  const regex = /([A-Z0-9][A-Z0-9 '&.!/()-]{2,80})\s*[–-]\s*([^|]{5,120}?)\s*[–-]\s*Adult Use\s*\|?\s*(\d{15,25})/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(plain)) !== null) {
    const name = match[1].trim().replace(/^Y\s+|^N\s+/i, '');
    const streetAddress = match[2].trim();
    const licenseNumber = match[3].trim();
    if (!name || !streetAddress || rows.some((row) => row.licenseNumber === licenseNumber)) continue;
    rows.push({ name, streetAddress, city: undefined, region: 'Nevada', country: 'USA', latitude: undefined, longitude: undefined, website: undefined, licenseNumber, dataSource: 'Nevada CCB Licensed Retail Locations', sourceUrl, sourceLicense: 'Official Nevada Cannabis Compliance Board public retail-location list.' });
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
    const lat = Number(pick(row, ['latitude','lat'])); const lng = Number(pick(row, ['longitude','lng','lon','long']));
    return { name, streetAddress: streetAddress || undefined, city: city || undefined, region, country: 'USA', latitude: Number.isFinite(lat) ? lat : undefined, longitude: Number.isFinite(lng) ? lng : undefined, website: undefined, licenseNumber, dataSource: 'Washington LCB Cannabis Renewal Open Data', sourceUrl, sourceLicense: 'Public data.wa.gov LCB Cannabis Renewal dataset; license not specified in catalog.', _type: type };
  }).filter((row) => row.name && (!row._type || /cannabis|marijuana|retail/i.test(row._type)));
  return rows.map(({ _type, ...row }) => row);
}

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const preset = String(body?.preset || '');
  try {
    if (preset === 'all') {
      const sources = [
        ['Oregon OLCC', await fetchOregon()],
        ['Nevada CCB', await fetchNevada()],
        ['Washington LCB', await fetchWashington()],
      ] as const;
      let added = 0;
      let fetched = 0;
      let total = 0;
      const details = [];
      for (const [source, rows] of sources) {
        const result = await importCandidates(rows as any[]);
        added += result.added; fetched += rows.length; total = result.total;
        details.push({ source, fetched: rows.length, added: result.added });
      }
      return NextResponse.json({ added, fetched, total, details, source: 'Official state sync' }, { status: 201 });
    }

    let rows: any[] = [];
    let source = '';
    if (preset === 'oregon-olcc') { rows = await fetchOregon(); source = 'Oregon OLCC Cannabis Business Licenses & Endorsements'; }
    else if (preset === 'nevada-ccb') { rows = await fetchNevada(); source = 'Nevada CCB Licensed Retail Locations'; }
    else if (preset === 'washington-lcb') { rows = await fetchWashington(); source = 'Washington LCB Cannabis Renewal Open Data'; }
    else return NextResponse.json({ error: 'Unknown official-data preset.' }, { status: 400 });
    const result = await importCandidates(rows);
    return NextResponse.json({ ...result, fetched: rows.length, source }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Official-data fetch failed.' }, { status: 502 });
  }
}
