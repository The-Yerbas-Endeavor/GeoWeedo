import { NextRequest, NextResponse } from 'next/server';
import { importCandidates } from '@/lib/candidateStore';

export const runtime = 'nodejs';

function authorized(request: NextRequest) {
  const expected = process.env.GEOWEEDO_ADMIN_SECRET;
  return Boolean(expected) && request.headers.get('x-geoweedo-admin') === expected;
}

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

function normalizeKey(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function first(row: Record<string, string>, keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== '') return row[key];
  return '';
}

function normalizedRows(text: string, source: string, sourceUrl?: string, sourceLicense?: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(normalizeKey);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = fields[index] || ''; });
    const latRaw = first(row, ['latitude', 'lat']);
    const lngRaw = first(row, ['longitude', 'lng', 'lon', 'long']);
    const latitude = Number(latRaw); const longitude = Number(lngRaw);
    return {
      name: first(row, ['businessname', 'licenseename', 'facilityname', 'tradename', 'name', 'doingbusinessas', 'dba']),
      streetAddress: first(row, ['streetaddress', 'address', 'premiseaddress', 'locationaddress', 'physicaladdress']),
      city: first(row, ['city', 'premisecity', 'locationcity']),
      region: first(row, ['state', 'region', 'province']),
      country: first(row, ['country']) || 'USA',
      latitude: Number.isFinite(latitude) ? latitude : undefined,
      longitude: Number.isFinite(longitude) ? longitude : undefined,
      website: first(row, ['website', 'url']) || undefined,
      licenseNumber: first(row, ['licensenumber', 'licenseid', 'license', 'credentialnumber']) || undefined,
      dataSource: source,
      sourceUrl,
      sourceLicense,
    };
  }).filter((row) => row.name);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'CSV file is required.' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Import file must be 10 MB or smaller.' }, { status: 400 });
  const source = String(form.get('dataSource') || 'official-license-registry').trim();
  const sourceUrl = String(form.get('sourceUrl') || '').trim() || undefined;
  const sourceLicense = String(form.get('sourceLicense') || '').trim() || undefined;
  const text = await file.text();
  const rows = normalizedRows(text, source, sourceUrl, sourceLicense);
  if (!rows.length) return NextResponse.json({ error: 'No usable rows found. Include a business/name column.' }, { status: 400 });
  const result = await importCandidates(rows);
  return NextResponse.json({ ...result, parsed: rows.length }, { status: 201 });
}
