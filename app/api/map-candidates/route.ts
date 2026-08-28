import { NextResponse } from 'next/server';
import { listCandidates } from '@/lib/candidateStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validCoordinates(latitude: unknown, longitude: unknown) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Number(latitude) >= -90 && Number(latitude) <= 90
    && Number(longitude) >= -180 && Number(longitude) <= 180;
}

export async function GET() {
  const all = (await listCandidates()).filter((item) => item.status !== 'rejected');
  const candidates = all
    .filter((item) => validCoordinates(item.latitude, item.longitude))
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

  const invalidCoordinates = all.filter((item) =>
    Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
    && !validCoordinates(item.latitude, item.longitude)
  ).length;
  const states = new Set(all.map((item) => item.region).filter(Boolean));
  return NextResponse.json({
    candidates,
    stats: {
      total: all.length,
      mapped: candidates.length,
      missingCoordinates: Math.max(0, all.length - candidates.length - invalidCoordinates),
      invalidCoordinates,
      states: states.size,
    },
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
