import 'server-only';

type Row = {
  name: string;
  streetAddress: string;
  city?: string;
  region: string;
  country: string;
  website?: string;
  licenseNumber?: string;
  dataSource: string;
  sourceUrl: string;
  sourceLicense: string;
  imageryStatus: 'missing_coordinates';
};

const SOURCE = 'https://ccc.ri.gov/cannabis-office/compassion-centers/licensed-compassion-centers';

function clean(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstLink(value: string) {
  const match = value.match(/href=["'](https?:\/\/[^"']+)["']/i);
  return match?.[1]?.trim();
}

export async function fetchRhodeIslandCandidates(): Promise<Row[]> {
  const response = await fetch(SOURCE, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'GeoWeedo/0.7 (https://geoweedo.com)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Rhode Island CCC licensed compassion centers returned ${response.status}`);
  }

  const html = await response.text();
  const rows: Row[] = [];
  const tr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = tr.exec(html)) !== null) {
    const rawCells: string[] = [];
    const cells: string[] = [];
    const td = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = td.exec(rowMatch[1])) !== null) {
      rawCells.push(cellMatch[1]);
      cells.push(clean(cellMatch[1]));
    }

    if (cells.length < 3) continue;

    const licenseIndex = cells.findIndex((value) => /^MMP\s*CC\s*\d+/i.test(value));
    if (licenseIndex < 0) continue;

    const licenseNumber = cells[licenseIndex];
    const name = cells[licenseIndex + 1] || '';
    const address = cells.find((value) => /\bRI\s+\d{5}\b/i.test(value));
    if (!name || !address) continue;

    const city = address.match(/(?:,|\s)([A-Za-z .'-]+),?\s+RI\s+\d{5}/i)?.[1]?.trim();
    const website = rawCells.map(firstLink).find(Boolean);

    rows.push({
      name,
      streetAddress: address,
      city,
      region: 'Rhode Island',
      country: 'USA',
      website,
      licenseNumber,
      dataSource: 'Rhode Island CCC Licensed Compassion Centers',
      sourceUrl: SOURCE,
      sourceLicense:
        'Official Rhode Island Cannabis Control Commission list of licensed Compassion Centers.',
      imageryStatus: 'missing_coordinates',
    });
  }

  const unique = new Map(rows.map((row) => [row.licenseNumber, row]));
  if (!unique.size) {
    throw new Error(
      'Rhode Island CCC returned zero parseable licensed retail locations; refusing an unverified import.',
    );
  }

  return Array.from(unique.values());
}
