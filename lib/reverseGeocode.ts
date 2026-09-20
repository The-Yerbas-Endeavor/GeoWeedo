import 'server-only';

export type ReverseGeocodeResult = {
  city?: string;
  postalCode?: string;
  region?: string;
  country?: string;
  displayName?: string;
};

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function countryName(address: Record<string, unknown>) {
  const code = String(address.country_code || '').trim().toLowerCase();
  if (code === 'us') return 'USA';
  if (code === 'ca') return 'Canada';
  return clean(address.country);
}

export async function reverseGeocodeCoordinates(latitude: number, longitude: number): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null;
  }

  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '18');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GeoWeedo/0.9 (https://geoweedo.com; coordinate locality backfill)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Reverse geocoder returned ${response.status}.`);

  const data = await response.json();
  const address = data?.address && typeof data.address === 'object' ? data.address as Record<string, unknown> : {};
  const city = clean(
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.hamlet ??
    address.city_district
  );
  const postalCode = clean(address.postcode);
  const region = clean(address.state ?? address.region);
  const country = countryName(address);

  if (!city && !postalCode && !region && !country) return null;
  return { city, postalCode, region, country, displayName: clean(data?.display_name) };
}
