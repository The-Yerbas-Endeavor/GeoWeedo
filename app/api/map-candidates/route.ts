import { NextResponse } from 'next/server';
import { listCandidates } from '@/lib/candidateStore';
import {getOrCreateDispensarySlug} from '@/lib/dispensarySlug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function basicValidCoordinates(latitude: unknown, longitude: unknown) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Number(latitude) >= -90 && Number(latitude) <= 90
    && Number(longitude) >= -180 && Number(longitude) <= 180;
}
function normalizedCountry(value: unknown) {
  const country = String(value || '').trim();
  if (!country) return 'USA';
  if (/^(us|u\.s\.|u\.s\.a\.|united states(?: of america)?)$/i.test(country)) return 'USA';
  if (/^(ca|can|canada)$/i.test(country)) return 'Canada';
  if (/^(nl|nld|the netherlands)$/i.test(country)) return 'Netherlands';
  return country;
}

// Keep map candidates inside a conservative geographic envelope for the country
// they claim to belong to. This prevents a bad geocode (for example an Arizona
// record landing in Australia) from stretching state fitBounds to a world view.
// The USA envelope deliberately includes Alaska and Hawaii.
function plausibleCountryCoordinates(countryValue: unknown, latitude: unknown, longitude: unknown) {
  if (!basicValidCoordinates(latitude, longitude)) return false;
  const country = normalizedCountry(countryValue);
  const lat = Number(latitude), lng = Number(longitude);
  if (country === 'USA') return lat >= 18 && lat <= 72 && lng >= -180 && lng <= -65;
  if (country === 'Canada') return lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52;
  if (country === 'Netherlands') return lat >= 50.5 && lat <= 54 && lng >= 3 && lng <= 8;
  return true;
}

export async function GET() {
  const all = (await listCandidates()).filter((item) => item.status !== 'rejected');
  const candidates = all.filter((item) => plausibleCountryCoordinates(item.country, item.latitude, item.longitude)).map((item) => ({
    id: item.id,
    slug:getOrCreateDispensarySlug(item.id),
    name: item.name,
    latitude: item.latitude as number,
    longitude: item.longitude as number,
    streetAddress: item.streetAddress || '',
    city: item.city || '',
    region: item.region || '',
    country: normalizedCountry(item.country),
    website: item.website || '',
    licenseNumber: item.licenseNumber || '',
    dataSource: item.dataSource,
    status: item.status,
    imageryStatus: item.imageryStatus || 'unchecked',
    profileTier:'mapped',
    mapCandidate: true,
  }));
  const invalidCoordinates = all.filter((item) => basicValidCoordinates(item.latitude, item.longitude) && !plausibleCountryCoordinates(item.country, item.latitude, item.longitude)).length
    + all.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && !basicValidCoordinates(item.latitude, item.longitude)).length;
  const regionMap = new Map<string, { region: string; country: string; total: number; mapped: number }>();
  const countryMap = new Map<string, { country: string; total: number; mapped: number; regions: number }>();
  for (const item of all) {
    const region = String(item.region || '').trim(),country = normalizedCountry(item.country),mapped = plausibleCountryCoordinates(item.country, item.latitude, item.longitude);
    if (region) {const regionKey = `${country}\u0000${region}`;const current = regionMap.get(regionKey) || { region, country, total: 0, mapped: 0 };current.total += 1;if (mapped) current.mapped += 1;regionMap.set(regionKey, current);}
    const currentCountry = countryMap.get(country) || { country, total: 0, mapped: 0, regions: 0 };currentCountry.total += 1;if (mapped) currentCountry.mapped += 1;countryMap.set(country, currentCountry);
  }
  const regions = Array.from(regionMap.values()).sort((a, b) => a.country.localeCompare(b.country) || a.region.localeCompare(b.region));
  const countryRows = Array.from(countryMap.values());for (const country of countryRows) country.regions = regions.filter((region) => region.country === country.country).length;
  const countries = countryRows.sort((a, b) => a.country.localeCompare(b.country));
  return NextResponse.json({candidates,regions,countries,stats:{total: all.length,mapped: candidates.length,missingCoordinates: Math.max(0, all.length - candidates.length - invalidCoordinates),invalidCoordinates,states: regions.filter((item) => item.country === 'USA').length,regions: regions.length,countries: countries.length}}, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
