import 'server-only';

import { getDatabase } from '@/lib/sqlite';

type Row = {
  name: string;
  streetAddress: string;
  city?: string;
  region: string;
  country: string;
  latitude?: number;
  longitude?: number;
  licenseNumber?: string;
  dataSource: string;
  sourceUrl: string;
  sourceLicense: string;
  imageryStatus: 'unchecked' | 'missing_coordinates';
};

const SOURCE = 'https://justice.gov.bc.ca/lcrb/map';
const MAP_SOURCE = 'https://justice.gov.bc.ca/lcrb/api/establishments/map';
const MAP_JSON_SOURCE = 'https://justice.gov.bc.ca/lcrb/api/establishments/map-json';
const DATA_SOURCE = 'British Columbia LCRB Cannabis Retail Stores';
const FEED_TIMEOUT_MS = 12000;

function text(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function number(value: unknown) {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validBritishColumbiaCoordinates(latitude?: number, longitude?: number) {
  return latitude !== undefined && longitude !== undefined && latitude >= 48.2 && latitude <= 60.1 && longitude >= -139.1 && longitude <= -113.8;
}

function asArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  if (!payload || typeof payload !== 'object') return [];
  const object = payload as Record<string, unknown>;
  for (const key of ['data', 'results', 'items', 'establishments', 'mapData']) {
    if (Array.isArray(object[key])) return (object[key] as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  return [];
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pick(item: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = text(item[key]);
    if (value) return value;
  }
  return '';
}

function toRows(sourceRows: Record<string, unknown>[]) {
  const rows: Row[] = [];
  for (const original of sourceRows) {
    const item: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(original)) item[normalizeHeader(key)] = value;

    const licenseNumber = pick(item, 'license', 'licence', 'licensenumber', 'licencenumber');
    const name = pick(item, 'name', 'establishmentname', 'businessname');
    const streetAddress = pick(item, 'addressstreet', 'streetaddress', 'address');
    const city = pick(item, 'addresscity', 'city');
    const latitude = number(item.latitude ?? item.lat);
    const longitude = number(item.longitude ?? item.lng ?? item.lon);
    const hasCoordinates = validBritishColumbiaCoordinates(latitude, longitude);

    if (!licenseNumber || !name || !streetAddress || !city) continue;

    rows.push({
      name,
      streetAddress,
      city,
      region: 'British Columbia',
      country: 'Canada',
      latitude: hasCoordinates ? latitude : undefined,
      longitude: hasCoordinates ? longitude : undefined,
      licenseNumber,
      dataSource: DATA_SOURCE,
      sourceUrl: SOURCE,
      sourceLicense: 'Official Government of British Columbia Liquor and Cannabis Regulation Branch Cannabis Retail Stores map; licensed cannabis retail stores only.',
      imageryStatus: hasCoordinates ? 'unchecked' : 'missing_coordinates',
    });
  }
  return rows;
}

async function fetchWithTimeout(url: string) {
  return fetch(url, {
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
      'User-Agent': 'GeoWeedo/0.8 (https://geoweedo.com)',
      'Accept-Language': 'en-CA,en;q=0.9',
      Referer: SOURCE,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
}

async function fetchOfficialMapRows(url: string) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}`);
  const body = await response.text();
  if (/^\s*</.test(body)) throw new Error(`${new URL(url).pathname} returned HTML instead of JSON`);
  let payload: unknown;
  try { payload = JSON.parse(body); }
  catch { throw new Error(`${new URL(url).pathname} returned invalid JSON`); }
  const rows = asArray(payload);
  if (!rows.length) throw new Error(`${new URL(url).pathname} returned no records`);
  return rows;
}

function quarantineStaleLegacyRows(currentRows: Row[]) {
  const currentLicenses = new Set(currentRows.map(row => row.licenseNumber?.trim().toLowerCase()).filter(Boolean));
  if (!currentLicenses.size) return 0;
  const db = getDatabase();
  const existing = db.prepare(`SELECT id, license_number FROM dispensary_candidates WHERE data_source = ? AND country = 'Canada' AND region = 'British Columbia' AND status != 'rejected'`).all(DATA_SOURCE) as {id:string;license_number?:string|null}[];
  const stale = existing.filter(row => !row.license_number || !currentLicenses.has(String(row.license_number).trim().toLowerCase()));
  if (!stale.length) return 0;
  const update = db.prepare(`UPDATE dispensary_candidates SET status='rejected', imagery_status='missing_coordinates', imagery_message=?, updated_at=? WHERE id=?`);
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of stale) {
      update.run('Quarantined after GeoWeedo corrected the B.C. source from the LRS liquor-store export to the official Cannabis Retail Stores map.', now, item.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return stale.length;
}

export async function fetchBritishColumbiaCandidates(): Promise<Row[]> {
  let sourceRows: Record<string, unknown>[];
  try {
    // Both endpoints expose the same official cannabis-map dataset. Return as
    // soon as either succeeds instead of waiting for a stalled mirror.
    sourceRows = await Promise.any([
      fetchOfficialMapRows(MAP_SOURCE),
      fetchOfficialMapRows(MAP_JSON_SOURCE),
    ]);
  } catch (error) {
    const reasons = error instanceof AggregateError
      ? error.errors.map(item => item instanceof Error ? item.message : String(item)).join(' ; ')
      : error instanceof Error ? error.message : String(error);
    throw new Error(`British Columbia LCRB cannabis map feeds were unavailable: ${reasons}`);
  }

  const rows = toRows(sourceRows);
  const unique = new Map(rows.map(row => [row.licenseNumber, row]));
  if (unique.size < 300) {
    throw new Error(`British Columbia LCRB cannabis map returned only ${unique.size} valid retail stores; refusing a suspiciously incomplete import.`);
  }

  const verified = Array.from(unique.values());
  quarantineStaleLegacyRows(verified);
  return verified;
}
