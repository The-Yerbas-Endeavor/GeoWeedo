import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { importCandidates } from '@/lib/candidateStore';
import { fetchBritishColumbiaCandidates } from '@/lib/officialSources/britishColumbia';
import { fetchRhodeIslandCandidates } from '@/lib/officialSources/rhodeIsland';

export const runtime = 'nodejs';

type Preset = 'british-columbia-lcrb' | 'rhode-island-ccc';
type CandidateRow = {
  name: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  country: string;
  latitude?: number;
  longitude?: number;
  website?: string;
  licenseNumber?: string;
  dataSource: string;
  sourceUrl: string;
  sourceLicense: string;
  imageryStatus: 'unchecked' | 'missing_coordinates';
};

type Source = {
  preset: Preset;
  label: string;
  fetcher: () => Promise<CandidateRow[]>;
};

const sources: Source[] = [
  {
    preset: 'british-columbia-lcrb',
    label: 'British Columbia LCRB',
    fetcher: fetchBritishColumbiaCandidates,
  },
  {
    preset: 'rhode-island-ccc',
    label: 'Rhode Island CCC',
    fetcher: fetchRhodeIslandCandidates,
  },
];

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const preset = String(body?.preset || '') as Preset;
  const source = sources.find((item) => item.preset === preset);

  if (!source) {
    return NextResponse.json({ error: 'Unknown British Columbia/Rhode Island preset.' }, { status: 400 });
  }

  try {
    const rows = await source.fetcher();
    if (!rows.length) throw new Error(`${source.label} returned zero valid dispensary records.`);

    const result = await importCandidates(rows as any[]);
    const geocoded = rows.filter(
      (row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude),
    ).length;

    return NextResponse.json(
      {
        ok: true,
        source: source.label,
        fetched: rows.length,
        added: result.added,
        geocoded,
        total: result.total,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
