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
  const regionMap = new Map<string, { region: string; total: number; mapped: number }>();
  for (const item of all) {
    const region = String(item.region || '').trim();
    if (!region) continue;
    const current = regionMap.get(region) || { region, total: 0, mapped: 0 };
    current.total += 1;
    if (validCoordinates(item.latitude, item.longitude)) current.mapped += 1;
    regionMap.set(region, current);
  }
  const regions = Array.from(regionMap.values()).sort((a, b) => a.region.localeCompare(b.region));
  return NextResponse.json({
    candidates,
    regions,
    stats: {
      total: all.length,
      mapped: candidates.length,
      missingCoordinates: Math.max(0, all.length - candidates.length - invalidCoordinates),
      invalidCoordinates,
      states: regions.length,
    },
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
