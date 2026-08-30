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

function clean(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchBritishColumbiaCandidates(): Promise<Row[]> {
  const response = await fetch(SOURCE, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'GeoWeedo/0.7 (https://geoweedo.com)',
      'Accept-Language': 'en-CA,en;q=0.9',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`British Columbia LCRB cannabis retail map returned ${response.status}`);
  }

  const html = await response.text();
  const rows: Row[] = [];
  const tr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = tr.exec(html)) !== null) {
    const cells: string[] = [];
    const td = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = td.exec(rowMatch[1])) !== null) cells.push(clean(cellMatch[1]));

    if (cells.length < 5) continue;

    const licenseNumber = cells[0];
    const name = cells[1];
    const streetAddress = cells[3];
    const city = cells[4];

    if (!/^\d{5,8}$/.test(licenseNumber) || !name || !streetAddress || !city) continue;

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
        'Official Government of British Columbia Liquor and Cannabis Regulation Branch map of licensed private non-medical cannabis retail stores.',
      imageryStatus: 'missing_coordinates',
    });
  }

  const unique = new Map(rows.map((row) => [row.licenseNumber, row]));
  if (!unique.size) {
    throw new Error(
      'British Columbia LCRB returned zero parseable licensed retail locations; refusing an unverified import.',
    );
  }

  return Array.from(unique.values());
}
