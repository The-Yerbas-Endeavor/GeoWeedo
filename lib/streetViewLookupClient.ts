import 'server-only';

export type StreetViewProvider = 'google' | 'kartaview';

export type StreetViewPhoto = {
  id: string;
  lat: number;
  lng: number;
  heading?: number;
  fieldOfView?: number;
  projection?: string;
  imageUrl: string;
  sequenceId?: string;
  sequenceIndex?: number;
};

export type StreetViewLookupResult = {
  provider: StreetViewProvider;
  photos: StreetViewPhoto[];
  initialIndex?: number;
  selectedPhotoId?: string | null;
  quality: {
    playable: boolean;
    grade?: string;
    mode?: string;
    reason?: string;
  };
  message?: string;
};

function localBaseUrl() {
  const port = Number(process.env.PORT || 3000);
  return `http://127.0.0.1:${Number.isFinite(port) ? port : 3000}`;
}

export async function lookupConfiguredStreetView(latitude: number, longitude: number, photoId?: string) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Invalid latitude or longitude.');
  }

  const url = new URL('/api/street-imagery', localBaseUrl());
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lng', String(longitude));
  if (photoId) url.searchParams.set('photoId', photoId);

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Street View lookup returned ${response.status}.`);
  if (!data || (data.provider !== 'google' && data.provider !== 'kartaview')) throw new Error('Street View returned an invalid provider response.');

  return data as StreetViewLookupResult;
}
