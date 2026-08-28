import 'server-only';

import { gradeImagery, type ImageryQualityResult } from '@/lib/imageryQuality';

type RawPhoto = Record<string, any>;

export type PlayableKartaViewPhoto = {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  fieldOfView: number;
  projection: string;
  imageUrl: string;
  sequenceId: string;
  sequenceIndex: number;
  width: number;
  height: number;
  status: string;
};

export type KartaViewInspection = {
  count: number;
  quality: ImageryQualityResult;
  selected?: PlayableKartaViewPhoto;
};

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalize(row: RawPhoto): PlayableKartaViewPhoto | null {
  const lat = num(row?.lat ?? row?.matchLat);
  const lng = num(row?.lng ?? row?.matchLng);
  const imageUrl = row?.fileurlProc || row?.fileurl || row?.fileurlLTh || row?.fileurlTh || '';
  if (!imageUrl || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: String(row?.id || ''),
    lat,
    lng,
    heading: num(row?.heading),
    fieldOfView: num(row?.fieldOfView),
    projection: String(row?.projection || '').toUpperCase(),
    imageUrl: String(imageUrl),
    sequenceId: String(row?.sequenceId || row?.sequence?.id || ''),
    sequenceIndex: num(row?.sequenceIndex),
    width: num(row?.width),
    height: num(row?.height),
    status: String(row?.status || ''),
  };
}

const headers = {
  Accept: 'application/json',
  'User-Agent': 'GeoWeedo/0.7 (https://geoweedo.yerbas.org)',
};

async function getJson(url: string) {
  const response = await fetch(url, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`KartaView returned ${response.status}`);
  return response.json();
}

async function getSequence(sequenceId: string) {
  const url = new URL('https://api.openstreetcam.org/2.0/photo/');
  url.searchParams.set('sequenceId', sequenceId);
  url.searchParams.set('page', '1');
  url.searchParams.set('itemsPerPage', '150');
  const json = await getJson(url.toString());
  const raw = Array.isArray(json?.result?.data) ? json.result.data : [];
  return raw.map(normalize).filter(Boolean) as PlayableKartaViewPhoto[];
}

export async function inspectKartaViewCoverage(lat: number, lng: number): Promise<KartaViewInspection> {
  const url = new URL('https://api.openstreetcam.org/2.0/photo/');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('zoomLevel', '18');
  url.searchParams.set('join', 'sequence');
  url.searchParams.set('orderBy', 'id');
  url.searchParams.set('orderDirection', 'desc');
  url.searchParams.set('radius', '500');

  const json = await getJson(url.toString());
  const raw = Array.isArray(json?.result?.data) ? json.result.data : [];
  const nearby = raw.map(normalize).filter(Boolean) as PlayableKartaViewPhoto[];
  if (!nearby.length) return { count: 0, quality: gradeImagery(undefined, []) };

  let bestFailure: KartaViewInspection | null = null;
  for (const candidate of nearby.slice(0, 12)) {
    const sequence = candidate.sequenceId ? await getSequence(candidate.sequenceId) : [candidate];
    const quality = gradeImagery(candidate, sequence);
    const inspection = { count: sequence.length, quality, selected: candidate };
    if (quality.playable) return inspection;
    if (!bestFailure || inspection.count > bestFailure.count) bestFailure = inspection;
  }

  return bestFailure || { count: 0, quality: gradeImagery(undefined, []) };
}
