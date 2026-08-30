export type ArizonaCandidate = {
  name: string;
  streetAddress?: string;
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

const SOURCE_URL = 'https://hsapps.azdhs.gov/ls/sod/Provider.aspx?ProviderName=';

function decode(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCityState(value: string) {
  const match = value.match(/^(.+?)\s+AZ\s+\d{5}(?:-\d{4})?$/i);
  return match ? match[1].trim() : value.replace(/\s+AZ(?:\s+\d{5}(?:-\d{4})?)?$/i, '').trim();
}

export async function fetchArizonaCandidates(): Promise<ArizonaCandidate[]> {
  const response = await fetch(SOURCE_URL, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'GeoWeedo/0.5 (https://geoweedo.com)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Arizona ADHS provider database returned ${response.status}.`);
  const html = await response.text();
  const rows: ArizonaCandidate[] = [];
  const tr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = tr.exec(html)) !== null) {
    const cells: string[] = [];
    const td = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cell: RegExpExecArray | null;
    while ((cell = td.exec(match[1])) !== null) cells.push(decode(cell[1]));
    if (cells.length < 4) continue;
    const offset = cells.length >= 5 && /^select$/i.test(cells[0]) ? 1 : 0;
    const name = cells[offset] || '';
    const streetAddress = cells[offset + 1] || '';
    const cityState = cells[offset + 2] || '';
    const type = cells[offset + 3] || '';
    if (!name || !/marijuana facilities/i.test(type)) continue;
    const city = parseCityState(cityState);
    rows.push({
      name,
      streetAddress: streetAddress || undefined,
      city: city || undefined,
      region: 'Arizona',
      country: 'USA',
      dataSource: 'Arizona ADHS Licensing Facilities and Providers',
      sourceUrl: SOURCE_URL,
      sourceLicense: 'Official Arizona Department of Health Services public licensing provider database; Marijuana Facilities only.',
      imageryStatus: 'missing_coordinates',
    });
  }
  const unique = new Map<string, ArizonaCandidate>();
  for (const row of rows) {
    const key = `${row.name}|${row.streetAddress || ''}|${row.city || ''}`.toLowerCase();
    if (!unique.has(key)) unique.set(key, row);
  }
  const result = Array.from(unique.values());
  if (!result.length) throw new Error('Arizona ADHS returned zero Marijuana Facilities; refusing a silent partial import.');
  return result;
}
