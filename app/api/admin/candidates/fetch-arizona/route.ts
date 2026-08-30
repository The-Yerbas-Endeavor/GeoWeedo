import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { importCandidates } from '@/lib/candidateStore';
import { fetchArizonaCandidates } from '@/lib/officialSources/arizona';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const rows = await fetchArizonaCandidates();
    const result = await importCandidates(rows as any[]);
    return NextResponse.json({
      source: 'Arizona ADHS',
      fetched: rows.length,
      added: result.added,
      geocoded: rows.filter(row => Number.isFinite(row.latitude) && Number.isFinite(row.longitude)).length,
      total: result.total,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
