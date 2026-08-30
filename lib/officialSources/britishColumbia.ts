import 'server-only';

type Row = {
  name: string;
  streetAddress: string;
  city?: string;
  region: string;
  country: string;
  licenseNumber?: string;
  dataSource: string;
  sourceUrl: string;
  sourceLicense: string;
  imageryStatus: 'missing_coordinates';
};

const SOURCE = 'https://justice.gov.bc.ca/lcrb/map';
const CSV_SOURCE = 'https://justice.gov.bc.ca/lcrb/api/establishments/lrs-csv';
const JSON_SOURCE = 'https://justice.gov.bc.ca/lcrb/api/establishments/lrs-json';
const FEED_TIMEOUT_MS = 20000;

function text(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function bool(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = text(value).toLowerCase();
  if (!normalized) return undefined;
  if (['true', '1', 'yes', 'open'].includes(normalized)) return true;
  if (['false', '0', 'no', 'closed', 'coming soon'].includes(normalized)) return false;
  return undefined;
}

function asArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  if (!payload || typeof payload !== 'object') return [];
  const object = payload as Record<string, unknown>;
  for (const key of ['data', 'results', 'items', 'establishments', 'licenseeRetailStores', 'lrsData']) {
    if (Array.isArray(object[key])) return (object[key] as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  return [];
}

function pick(item: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = text(item[key]);
    if (value) return value;
  }
  return '';
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(csv: string) {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => { row[header] = cells[index] ?? ''; });
    return row;
  });
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
    const open = bool(item.isopen ?? item.open ?? item.status);

    if (open === false) continue;
    if (!licenseNumber || !name || !streetAddress || !city) continue;

    rows.push({
      name,
      streetAddress,
      city,
      region: 'British Columbia',
      country: 'Canada',
      licenseNumber,
      dataSource: 'British Columbia LCRB Cannabis Retail Stores',
      sourceUrl: SOURCE,
      sourceLicense:
        'Official Government of British Columbia Liquor and Cannabis Regulation Branch licensed cannabis retail store feed; open stores only.',
      imageryStatus: 'missing_coordinates',
    });
  }
  return rows;
}

async function fetchWithTimeout(url: string, accept: string) {
  return fetch(url, {
    headers: {
      Accept: accept,
      'User-Agent': 'GeoWeedo/0.8 (https://geoweedo.com)',
      'Accept-Language': 'en-CA,en;q=0.9',
      Referer: SOURCE,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
}

async function fetchCsvRows() {
  const response = await fetchWithTimeout(CSV_SOURCE, 'text/csv,text/plain;q=0.9,*/*;q=0.8');
  if (!response.ok) throw new Error(`CSV feed returned ${response.status}`);
  const body = await response.text();
  if (/^\s*</.test(body)) throw new Error('CSV endpoint returned HTML instead of CSV');
  const rows = parseCsv(body);
  if (!rows.length) throw new Error('CSV feed returned no rows');
  return rows;
}

async function fetchJsonRows() {
  const response = await fetchWithTimeout(JSON_SOURCE, 'application/json,text/plain;q=0.9,*/*;q=0.8');
  if (!response.ok) throw new Error(`JSON feed returned ${response.status}`);
  const body = await response.text();
  if (/^\s*</.test(body)) throw new Error('JSON endpoint returned HTML instead of JSON');
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`JSON endpoint returned invalid JSON (${response.headers.get('content-type') || 'unknown content type'})`);
  }
  const rows = asArray(payload);
  if (!rows.length) throw new Error('JSON feed returned no rows');
  return rows;
}

export async function fetchBritishColumbiaCandidates(): Promise<Row[]> {
  let sourceRows: Record<string, unknown>[];
  try {
    // The two official downloads are mirrors of the same LCRB retail-store
    // dataset. Request them concurrently so a stalled endpoint cannot make the
    // entire multi-jurisdiction sync wait through two consecutive timeouts.
    sourceRows = await Promise.any([fetchCsvRows(), fetchJsonRows()]);
  } catch (error) {
    const reasons = error instanceof AggregateError
      ? error.errors.map((item) => item instanceof Error ? item.message : String(item)).join(' ; ')
      : error instanceof Error ? error.message : String(error);
    throw new Error(`British Columbia LCRB official feeds were unavailable: ${reasons}`);
  }

  const rows = toRows(sourceRows);
  const unique = new Map(rows.map((row) => [row.licenseNumber, row]));
  if (!unique.size) {
    throw new Error(
      `British Columbia LCRB feed returned ${sourceRows.length} record(s) but zero verified open retail stores; refusing an unverified import.`,
    );
  }

  return Array.from(unique.values());
}
