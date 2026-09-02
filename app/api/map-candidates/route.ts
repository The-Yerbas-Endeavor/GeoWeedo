import { NextResponse } from 'next/server';
import { listCandidates } from '@/lib/candidateStore';
import {getOrCreateDispensarySlug} from '@/lib/dispensarySlug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validCoordinates(latitude: unknown, longitude: unknown) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Number(latitude) >= -90 && Number(latitude) <= 90
    && Number(longitude) >= -180 && Number(longitude) <= 180;
}
function normalizedCountry(value: unknown) {
  const country = String(value || '').trim();
  if (!country) return 'USA';
  if (/^(us|u\.s\.|u\.s\.a\.|united states(?: of america)?)$/i.test(country)) return 'USA';
  if (/^(nl|nld|the netherlands)$/i.test(country)) return 'Netherlands';
  return country;
}

export async function GET() {
  const all = (await listCandidates()).filter((item) => item.status !== 'rejected');
  const candidates = all.filter((item) => validCoordinates(item.latitude, item.longitude)).map((item) => ({
    id: item.id,
    slug:getOrCreateDispensarySlug(item.id),
    name: item.name,
    latitude: item.latitude as number,
    longitude: item.longitude as number,
    city: item.city || '',
    region: item.region || '',
    country: normalizedCountry(item.country),
    dataSource: item.dataSource,
    status: item.status,
    imageryStatus: item.imageryStatus || 'unchecked',
    profileTier:'mapped',
    mapCandidate: true,
  }));
  const invalidCoordinates = all.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && !validCoordinates(item.latitude, item.longitude)).length;
  const regionMap = new Map<string, { region: string; country: string; total: number; mapped: number }>();
  const countryMap = new Map<string, { country: string; total: number; mapped: number; regions: number }>();
  for (const item of all) {
    const region = String(item.region || '').trim(),country = normalizedCountry(item.country),mapped = validCoordinates(item.latitude, item.longitude);
    if (region) {const regionKey = `${country}\u0000${region}`;const current = regionMap.get(regionKey) || { region, country, total: 0, mapped: 0 };current.total += 1;if (mapped) current.mapped += 1;regionMap.set(regionKey, current);}
    const currentCountry = countryMap.get(country) || { country, total: 0, mapped: 0, regions: 0 };currentCountry.total += 1;if (mapped) currentCountry.mapped += 1;countryMap.set(country, currentCountry);
  }
  const regions = Array.from(regionMap.values()).sort((a, b) => a.country.localeCompare(b.country) || a.region.localeCompare(b.region));
  const countryRows = Array.from(countryMap.values());for (const country of countryRows) country.regions = regions.filter((region) => region.country === country.country).length;
  const countries = countryRows.sort((a, b) => a.country.localeCompare(b.country));
  return NextResponse.json({candidates,regions,countries,stats:{total: all.length,mapped: candidates.length,missingCoordinates: Math.max(0, all.length - candidates.length - invalidCoordinates),invalidCoordinates,states: regions.filter((item) => item.country === 'USA').length,regions: regions.length,countries: countries.length}}, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
