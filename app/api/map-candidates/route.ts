import { NextResponse } from 'next/server';
import { listCandidates } from '@/lib/candidateStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const all = (await listCandidates()).filter((item) => item.status !== 'rejected');
  const candidates = all
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

  const states = new Set(all.map((item) => item.region).filter(Boolean));
  return NextResponse.json({
    candidates,
    stats: {
      total: all.length,
      mapped: candidates.length,
      missingCoordinates: Math.max(0, all.length - candidates.length),
      states: states.size,
    },
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
