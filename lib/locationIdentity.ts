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

const REGION_ALIASES: Record<string,string> = {
  AL:'alabama',AK:'alaska',AZ:'arizona',AR:'arkansas',CA:'california',CO:'colorado',CT:'connecticut',DE:'delaware',FL:'florida',GA:'georgia',
  HI:'hawaii',ID:'idaho',IL:'illinois',IN:'indiana',IA:'iowa',KS:'kansas',KY:'kentucky',LA:'louisiana',ME:'maine',MD:'maryland',
  MA:'massachusetts',MI:'michigan',MN:'minnesota',MS:'mississippi',MO:'missouri',MT:'montana',NE:'nebraska',NV:'nevada',NH:'new hampshire',NJ:'new jersey',
  NM:'new mexico',NY:'new york',NC:'north carolina',ND:'north dakota',OH:'ohio',OK:'oklahoma',OR:'oregon',PA:'pennsylvania',RI:'rhode island',SC:'south carolina',
  SD:'south dakota',TN:'tennessee',TX:'texas',UT:'utah',VT:'vermont',VA:'virginia',WA:'washington',WV:'west virginia',WI:'wisconsin',WY:'wyoming',DC:'district of columbia',
  AB:'alberta',BC:'british columbia',MB:'manitoba',NB:'new brunswick',NL:'newfoundland and labrador',NS:'nova scotia',NT:'northwest territories',NU:'nunavut',
  ON:'ontario',PE:'prince edward island',QC:'quebec',SK:'saskatchewan',YT:'yukon'
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

function normalizedCountry(value: unknown) {
  const normalized = text(value);
  if (['us','usa','united states','united states of america'].includes(normalized)) return 'united states';
  if (['ca','can','canada'].includes(normalized)) return 'canada';
  return normalized;
}

function normalizedRegion(value: unknown) {
  const raw = String(value ?? '').trim();
  const upper = raw.toUpperCase();
  if (REGION_ALIASES[upper]) return REGION_ALIASES[upper];
  return text(raw).replace(/ state$/, '');
}

function license(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function finite(value: unknown) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compatibleJurisdiction(a: LocationIdentityInput, b: LocationIdentityInput) {
  const countryA = normalizedCountry(a.country);
  const countryB = normalizedCountry(b.country);
  if (countryA && countryB && countryA !== countryB) return false;

  const regionA = normalizedRegion(a.region);
  const regionB = normalizedRegion(b.region);
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
  const region = normalizedRegion(input.region);
  const country = normalizedCountry(input.country);
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
