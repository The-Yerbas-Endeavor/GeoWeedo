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
const JSON_SOURCE = 'https://justice.gov.bc.ca/lcrb/api/establishments/lrs-json';

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

export async function fetchBritishColumbiaCandidates(): Promise<Row[]> {
  const response = await fetch(JSON_SOURCE, {
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
      'User-Agent': 'GeoWeedo/0.7 (https://geoweedo.com)',
      'Accept-Language': 'en-CA,en;q=0.9',
      Referer: SOURCE,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`British Columbia LCRB JSON feed returned ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('British Columbia LCRB JSON feed did not return valid JSON.');
  }

  const sourceRows = asArray(payload);
  const rows: Row[] = [];

  for (const item of sourceRows) {
    const licenseNumber = pick(item, 'license', 'licence', 'licenseNumber', 'licenceNumber');
    const name = pick(item, 'name', 'establishmentName', 'businessName');
    const streetAddress = pick(item, 'addressStreet', 'streetAddress', 'address');
    const city = pick(item, 'addressCity', 'city');
    const open = bool(item.isOpen ?? item.open ?? item.status);

    // The official page distinguishes stores that are open from stores that are
    // merely coming soon. GeoWeedo only imports operating storefronts.
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
        'Official Government of British Columbia Liquor and Cannabis Regulation Branch licensed cannabis retail store JSON feed; open stores only.',
      imageryStatus: 'missing_coordinates',
    });
  }

  const unique = new Map(rows.map((row) => [row.licenseNumber, row]));
  if (!unique.size) {
    throw new Error(
      `British Columbia LCRB JSON feed returned ${sourceRows.length} record(s) but zero verified open retail stores; refusing an unverified import.`,
    );
  }

  return Array.from(unique.values());
}
