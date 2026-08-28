import { NextResponse } from 'next/server';
import { listCandidates } from '@/lib/candidateStore';

export const runtime = 'nodejs';

export async function GET() {
  const candidates = (await listCandidates())
    .filter((item) => item.status !== 'rejected')
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .map((item) => ({
      id: item.id,
      name: item.name,
      latitude: item.latitude as number,
      longitude: item.longitude as number,
      city: item.city || '',
      region: item.region || '',
      country: item.country || 'USA',
      dataSource: item.dataSource,
      status: item.status,
      imageryStatus: item.imageryStatus || 'unchecked',
      mapCandidate: true,
    }));

  return NextResponse.json({ candidates }, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  });
}
