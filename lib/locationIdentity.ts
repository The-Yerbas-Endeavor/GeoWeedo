export type LocationIdentityInput = {
  name?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  licenseNumber?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function text(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function license(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compatibleJurisdiction(a: LocationIdentityInput, b: LocationIdentityInput) {
  const countryA = text(a.country);
  const countryB = text(b.country);
  if (countryA && countryB && countryA !== countryB) return false;

  const regionA = text(a.region);
  const regionB = text(b.region);
  if (regionA && regionB && regionA !== regionB) return false;

  return Boolean(countryA || countryB || regionA || regionB);
}

export function strongLocationIdentityMatch(a: LocationIdentityInput, b: LocationIdentityInput) {
  if (!compatibleJurisdiction(a, b)) return false;

  const licenseA = license(a.licenseNumber);
  const licenseB = license(b.licenseNumber);
  if (licenseA && licenseB && licenseA === licenseB) return true;

  const nameA = text(a.name);
  const nameB = text(b.name);
  if (!nameA || !nameB || nameA !== nameB) return false;

  const streetA = text(a.streetAddress);
  const streetB = text(b.streetAddress);
  const cityA = text(a.city);
  const cityB = text(b.city);
  const regionA = text(a.region);
  const regionB = text(b.region);

  if (
    streetA && streetB && streetA === streetB &&
    cityA && cityB && cityA === cityB &&
    regionA && regionB && regionA === regionB
  ) return true;

  const latA = finite(a.latitude);
  const latB = finite(b.latitude);
  const lngA = finite(a.longitude);
  const lngB = finite(b.longitude);
  if (
    latA !== null && latB !== null &&
    lngA !== null && lngB !== null &&
    Math.abs(latA - latB) <= 0.0002 &&
    Math.abs(lngA - lngB) <= 0.0002
  ) return true;

  return false;
}

export function strongLocationIdentityKeys(input: LocationIdentityInput) {
  const keys: string[] = [];
  const name = text(input.name);
  const street = text(input.streetAddress);
  const city = text(input.city);
  const region = text(input.region);
  const country = text(input.country);
  const licenseNumber = license(input.licenseNumber);

  if (licenseNumber && region && country) keys.push(`license:${country}:${region}:${licenseNumber}`);

  if (name && street && city && region) {
    keys.push(`address:${country}:${region}:${city}:${street}:${name}`);
  }

  const latitude = finite(input.latitude);
  const longitude = finite(input.longitude);
  if (name && region && latitude !== null && longitude !== null) {
    keys.push(`coord:${country}:${region}:${name}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`);
  }

  return keys;
}
