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
  if (!imageUrl) return null;
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
  'User-Agent': 'GeoWeedo/0.8 (https://geoweedo.yerbas.org)',
};

async function getJson(url: string) {
  const response = await fetch(url, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`KartaView returned ${response.status}`);
  return response.json();
}

async function getSequence(sequenceId: string) {
  const json = await getJson(`https://api.openstreetcam.org/2.0/sequence/${encodeURIComponent(sequenceId)}/photos`);
  const raw = Array.isArray(json?.result?.data) ? json.result.data : [];
  return raw.map(normalize).filter(Boolean) as PlayableKartaViewPhoto[];
}

function parseJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    if (offset + 4 >= bytes.length) break;
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 9 < bytes.length) {
      const height = (bytes[offset + 5] << 8) + bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) + bytes[offset + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

async function readImageDimensions(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'GeoWeedo/0.8 (https://geoweedo.yerbas.org)',
        Range: 'bytes=0-65535',
      },
      cache: 'no-store',
    });
    if (!response.ok && response.status !== 206) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return parseJpegDimensions(bytes);
  } catch {
    return null;
  }
}

async function enrichDimensions(selected: PlayableKartaViewPhoto, sequence: PlayableKartaViewPhoto[]) {
  const sample: PlayableKartaViewPhoto[] = [];
  const seen = new Set<string>();
  const add = (photo: PlayableKartaViewPhoto | undefined) => {
    if (!photo || !photo.id || seen.has(photo.id)) return;
    seen.add(photo.id);
    sample.push(photo);
  };

  add(sequence.find((photo) => photo.id === selected.id) || selected);
  if (sequence.length) {
    const targetSamples = Math.min(6, sequence.length);
    for (let i = 0; i < targetSamples; i++) {
      const index = targetSamples === 1 ? 0 : Math.round((i * (sequence.length - 1)) / (targetSamples - 1));
      add(sequence[index]);
    }
  }

  await Promise.all(sample.map(async (photo) => {
    if (photo.width > 0 && photo.height > 0) return;
    const dimensions = await readImageDimensions(photo.imageUrl);
    if (!dimensions) return;
    photo.width = dimensions.width;
    photo.height = dimensions.height;
    if (photo.id === selected.id) {
      selected.width = dimensions.width;
      selected.height = dimensions.height;
    }
  }));
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
    if (sequence.length) await enrichDimensions(candidate, sequence);
    const quality = gradeImagery(candidate, sequence);
    const inspection = { count: sequence.length, quality, selected: candidate };
    if (quality.playable) return inspection;
    if (!bestFailure || inspection.count > bestFailure.count) bestFailure = inspection;
  }

  return bestFailure || { count: 0, quality: gradeImagery(undefined, []) };
}
