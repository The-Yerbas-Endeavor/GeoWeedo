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

function normalizeObject(input: Record<string, unknown>, source: string, sourceUrl?: string, sourceLicense?: string) {
  const row: Record<string, string> = {};
  Object.entries(input).forEach(([key, value]) => { row[normalizeKey(key)] = value == null ? '' : String(value).trim(); });
  const latRaw = first(row, ['latitude', 'lat']);
  const lngRaw = first(row, ['longitude', 'lng', 'lon', 'long']);
  const latitude = Number(latRaw); const longitude = Number(lngRaw);
  return {
    name: first(row, ['businessname', 'licenseename', 'facilityname', 'tradename', 'name', 'doingbusinessas', 'dba', 'premisename']),
    streetAddress: first(row, ['streetaddress', 'address', 'premiseaddress', 'locationaddress', 'physicaladdress', 'premisestreetaddress']),
    city: first(row, ['city', 'premisecity', 'locationcity']),
    region: first(row, ['state', 'region', 'province', 'premisestate']),
    country: first(row, ['country']) || 'USA',
    latitude: Number.isFinite(latitude) ? latitude : undefined,
    longitude: Number.isFinite(longitude) ? longitude : undefined,
    website: first(row, ['website', 'url']) || undefined,
    licenseNumber: first(row, ['licensenumber', 'licenseid', 'license', 'credentialnumber', 'licenseno']) || undefined,
    dataSource: source,
    sourceUrl,
    sourceLicense,
  };
}

function normalizedCsvRows(text: string, source: string, sourceUrl?: string, sourceLicense?: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const object: Record<string, unknown> = {};
    headers.forEach((header, index) => { object[header] = fields[index] || ''; });
    return normalizeObject(object, source, sourceUrl, sourceLicense);
  }).filter((row) => row.name);
}

function normalizedJsonRows(text: string, source: string, sourceUrl?: string, sourceLicense?: string) {
  const parsed = JSON.parse(text);
  const array = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.results) ? parsed.results : [];
  return array
    .filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => normalizeObject(item, source, sourceUrl, sourceLicense))
    .filter((row) => row.name);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'CSV or JSON file is required.' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Import file must be 10 MB or smaller.' }, { status: 400 });
  const source = String(form.get('dataSource') || 'official-license-registry').trim();
  const sourceUrl = String(form.get('sourceUrl') || '').trim() || undefined;
  const sourceLicense = String(form.get('sourceLicense') || '').trim() || undefined;
  const text = await file.text();
  let rows;
  try {
    const isJson = file.name.toLowerCase().endsWith('.json') || file.type.includes('json') || text.trimStart().startsWith('[') || text.trimStart().startsWith('{');
    rows = isJson ? normalizedJsonRows(text, source, sourceUrl, sourceLicense) : normalizedCsvRows(text, source, sourceUrl, sourceLicense);
  } catch {
    return NextResponse.json({ error: 'The uploaded CSV/JSON could not be parsed.' }, { status: 400 });
  }
  if (!rows.length) return NextResponse.json({ error: 'No usable rows found. Include a business/name column.' }, { status: 400 });
  const result = await importCandidates(rows);
  return NextResponse.json({ ...result, parsed: rows.length }, { status: 201 });
}
