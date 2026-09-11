import 'server-only';

export type RetailId1A4Analyte = {
  groupName: string;
  analyteName: string;
  value: number | null;
  unit: string | null;
  status?: string | null;
  limitValue?: number | null;
  limitUnit?: string | null;
};

export type RetailId1A4Record = {
  url: string;
  apiUrl: string;
  retailId: string | null;
  serial: string | null;
  title: string | null;
  productName: string | null;
  explicitProductName: boolean;
  brandName: string | null;
  productType: string | null;
  netContents: string | null;
  cultivar: string | null;
  batchNumber: string | null;
  facility: string | null;
  facilityLicense: string | null;
  labName: string | null;
  labLicense: string | null;
  coaNumber: string | null;
  coaDocumentId: string | null;
  testedAt: string | null;
  overallStatus: string | null;
  coaUrl: string | null;
  thcText: string | null;
  cbdText: string | null;
  analytes: RetailId1A4Analyte[];
  marketCode: string | null;
  isOnRecall: boolean;
  pageText: string;
  rawPayload: unknown;
};

const HOSTS = new Set(['1a4.com', 'www.1a4.com', 'app.1a4.com', 'www.app.1a4.com']);

export function isRetailId1A4Url(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && HOSTS.has(url.hostname.toLowerCase()) && /^\/landingpage\//i.test(url.pathname);
  } catch {
    return false;
  }
}

export function retailIdFrom1A4Url(value: string) {
  if (!isRetailId1A4Url(value)) return null;
  const url = new URL(value);
  const parts = url.pathname.split('/').filter(Boolean);
  const candidate = parts[1] || '';
  return /^1a4[a-z0-9]{21}$/i.test(candidate) ? candidate.toUpperCase() : null;
}

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function walk(value: any, visit: (key: string, value: any) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walk(child, visit);
  }
}

function firstJsonText(root: any, keys: string[]) {
  const wanted = new Set(keys.map(key => key.toLowerCase().replace(/[^a-z0-9]/g, '')));
  let found: string | null = null;
  walk(root, (key, value) => {
    if (found || !['string', 'number'].includes(typeof value)) return;
    if (!wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return;
    const text = String(value).trim();
    if (text) found = text;
  });
  return found;
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function parseEmbeddedJson(value: unknown) {
  if (value && typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : null;
  } catch {
    return null;
  }
}

function absoluteUrl(base: string, candidate: unknown) {
  const text = clean(candidate);
  if (!text) return null;
  try { return new URL(text, base).toString(); } catch { return null; }
}

function findUrl(root: any, base: string) {
  const keys = new Set([
    'coaurl', 'certificateurl', 'reporturl', 'labreporturl', 'downloadurl',
    'fileurl', 'documenturl', 'pdfurl',
  ]);
  let found: string | null = null;
  walk(root, (key, value) => {
    if (found || typeof value !== 'string') return;
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!keys.has(normalized)) return;
    found = absoluteUrl(base, value);
  });
  return found;
}

function prettyAnalyteName(key: string, isTotal = false) {
  const normalized = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  const compact = normalized.replace(/\s+/g, '').toLowerCase();
  const names: Record<string, string> = {
    thc: 'THC', thca: 'THCA', thcv: 'THCV', cbd: 'CBD', cbda: 'CBDA',
    cbdv: 'CBDV', cbg: 'CBG', cbga: 'CBGA', cbn: 'CBN', cbc: 'CBC',
    delta8thc: 'Delta-8 THC', delta9thc: 'Delta-9 THC',
    totalcbd: 'Total CBD', totalthc: 'Total THC', totaldelta9thc: 'Total Delta-9 THC',
  };
  const mapped = names[compact] || normalized.replace(/\b\w/g, char => char.toUpperCase());
  if (isTotal && !/^total\b/i.test(mapped)) return `Total ${mapped}`;
  return mapped;
}

function measurementFromEntry(key: string, entry: any, groupName: string, forceTotal = false): RetailId1A4Analyte | null {
  if (!entry || typeof entry !== 'object') return null;
  const percent = asNumber(entry.percent);
  const weightAmount = asNumber(entry.weight?.amount ?? entry.weight?.pkg);
  const rawValue = percent ?? asNumber(entry.value ?? entry.amount ?? entry.result);
  const value = rawValue ?? weightAmount;
  if (value === null && !clean(entry.status)) return null;
  const isTotal = forceTotal || Boolean(entry.flags?.isTotal);
  const unit = percent !== null ? '%' : clean(entry.unit ?? entry.weight?.unit);
  return {
    groupName,
    analyteName: prettyAnalyteName(key, isTotal),
    value,
    unit,
    status: clean(entry.status ?? entry.resultStatus ?? entry.passFail),
    limitValue: asNumber(entry.limit ?? entry.actionLimit ?? entry.limitValue),
    limitUnit: clean(entry.limitUnit ?? entry.actionLimitUnit),
  };
}

function collectAnalytes(coa: any) {
  const out: RetailId1A4Analyte[] = [];
  const seen = new Set<string>();
  const push = (row: RetailId1A4Analyte | null) => {
    if (!row) return;
    const key = `${row.groupName}|${row.analyteName.toLowerCase()}|${row.value ?? ''}|${row.unit ?? ''}|${row.status ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };

  const ingredients = coa?.ingredients;
  if (ingredients && typeof ingredients === 'object') {
    for (const [key, entry] of Object.entries(ingredients)) {
      const kind = clean((entry as any)?.kind)?.toLowerCase();
      if (kind === 'cannabinoid' || /(?:thc|cbd|cbg|cbn|cbc)/i.test(key)) {
        push(measurementFromEntry(key, entry, 'cannabinoid'));
      }
    }
  }

  const totals = coa?.totals;
  if (totals && typeof totals === 'object') {
    for (const [key, entry] of Object.entries(totals)) {
      const kind = clean((entry as any)?.kind)?.toLowerCase();
      if (kind === 'cannabinoid' || /(?:thc|cbd|cbg|cbn|cbc)/i.test(key)) {
        push(measurementFromEntry(key, entry, 'cannabinoid', true));
      }
    }
  }

  const terpenes = coa?.terpenes;
  if (terpenes && typeof terpenes === 'object') {
    for (const [key, entry] of Object.entries(terpenes)) {
      push(measurementFromEntry(key, entry, 'terpene'));
    }
  }

  // Some Retail ID payloads expose compliance panels under nonCannabinoids.
  // Keep their source-reported status/measurements without trying to reinterpret
  // regulatory limits here.
  const nonCannabinoids = coa?.nonCannabinoids;
  if (nonCannabinoids && typeof nonCannabinoids === 'object') {
    for (const [groupKey, groupValue] of Object.entries(nonCannabinoids)) {
      if (Array.isArray(groupValue)) {
        for (const entry of groupValue) {
          const name = clean((entry as any)?.name ?? (entry as any)?.analyteName ?? (entry as any)?.analyte) || groupKey;
          const row = measurementFromEntry(name, entry, groupKey.toLowerCase().replace(/\s+/g, '_'));
          push(row);
        }
      } else if (groupValue && typeof groupValue === 'object') {
        const row = measurementFromEntry(groupKey, groupValue, groupKey.toLowerCase().replace(/\s+/g, '_'));
        push(row);
      }
    }
  }

  return out;
}

function packageSize(coa: any) {
  const weight = asNumber(coa?.unit?.weight);
  const name = clean(coa?.unit?.weightUnitOfMeasureName);
  if (weight !== null && name) {
    const unit = /^grams?$/i.test(name) ? 'g'
      : /^milligrams?$/i.test(name) ? 'mg'
        : /^ounces?$/i.test(name) ? 'oz'
          : name;
    return `${weight} ${unit}`;
  }
  return clean(coa?.servingSize) || null;
}

function potencyText(coa: any, key: 'thc' | 'cbd') {
  const total = coa?.totals?.[key] ?? coa?.ingredients?.[`total${key.toUpperCase()}`] ?? coa?.ingredients?.[`total${key[0].toUpperCase()}${key.slice(1)}`];
  if (!total || typeof total !== 'object') return null;
  const percent = asNumber(total.percent);
  if (percent !== null) return `${percent}%`;
  const amount = asNumber(total.weight?.pkg ?? total.weight?.amount);
  const unit = clean(total.weight?.unit ?? total.unit);
  return amount !== null ? `${amount}${unit ? ` ${unit}` : ''}` : null;
}

async function fetchLandingData(input: URL) {
  const parts = input.pathname.split('/').filter(Boolean);
  const id = parts[1] || '';
  const rawIndex = parts[2] || '';
  const parsedIndex = Number.parseInt(rawIndex, 10);
  const index = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0;
  if (!id) throw new Error('Retail ID URL is missing its issuance ID.');

  // This is the same public request used by the 1A4 browser application:
  // GET /api/landingpage/data?id=<issuanceId>&index=<index>
  const apiUrl = new URL('/api/landingpage/data', input.origin);
  apiUrl.searchParams.set('id', id);
  apiUrl.searchParams.set('index', String(index));
  const response = await fetch(apiUrl.toString(), {
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
    headers: {
      Accept: 'application/json,text/plain,*/*',
      Referer: input.toString(),
      'User-Agent': 'GeoWeedo/1.0 (+https://geoweedo.com)',
    },
  });
  if (!response.ok) throw new Error(`Retail ID data API returned ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (!/json/i.test(contentType)) throw new Error(`Retail ID data API returned unexpected content type: ${contentType || 'unknown'}.`);
  const payload = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error('Retail ID data API returned an empty payload.');
  return { payload: payload as Record<string, any>, apiUrl: response.url || apiUrl.toString(), serial: String(index) };
}

export async function fetchRetailId1A4(value: string): Promise<RetailId1A4Record> {
  if (!isRetailId1A4Url(value)) throw new Error('Unsupported Retail ID URL.');
  const input = new URL(value);
  const uidFromPath = retailIdFrom1A4Url(value);
  const { payload, apiUrl, serial } = await fetchLandingData(input);
  const coaCard = payload.coaCard && typeof payload.coaCard === 'object' ? payload.coaCard : null;
  const coa = parseEmbeddedJson(coaCard?.data) || {};

  const productName = clean(coa.productName ?? coa.title)
    || firstJsonText(payload, ['productName', 'itemName']);
  const retailId = clean(payload.packageLabel ?? coa.lotNumber ?? coa.id)?.toUpperCase() || uidFromPath;
  const labName = clean(coa.lab?.name) || firstJsonText(coa, ['labName', 'testingLab']);
  const labLicense = clean(coa.lab?.licenseNumber) || firstJsonText(coa, ['labLicense', 'labLicenseNumber']);
  const documentId = clean(coa.lab?.docId ?? coa.documentId ?? coa.coaId);
  const batchNumber = clean(coa.batch ?? coa.sourceBatch ?? coa.batchNumber);
  const testedAt = normalizeDate(clean(coa.dateTested ?? coa.testedDate ?? coa.labTests?.[0]?.at));
  const analytes = collectAnalytes(coa);
  const coaUrl = findUrl(coaCard, input.toString()) || findUrl(coa, input.toString());
  const overallStatus = firstJsonText(coa, ['overallStatus', 'complianceStatus', 'resultStatus', 'passFail']);

  return {
    url: input.toString(),
    apiUrl,
    retailId,
    serial,
    title: clean(coa.title) || productName,
    productName,
    explicitProductName: Boolean(productName),
    brandName: firstJsonText(payload, ['brandName', 'brand']) || firstJsonText(coa, ['brandName', 'brand']),
    productType: clean(coa.category) || firstJsonText(payload, ['productType', 'category']),
    netContents: packageSize(coa),
    cultivar: clean(coa.strainName ?? coa.strain),
    batchNumber,
    facility: clean(payload.facilityName) || firstJsonText(coa, ['facilityName', 'producerName', 'manufacturerName']),
    facilityLicense: clean(payload.facilityLicense) || firstJsonText(coa, ['facilityLicense', 'producerLicense']),
    labName,
    labLicense,
    coaNumber: documentId,
    coaDocumentId: documentId,
    testedAt,
    overallStatus,
    coaUrl,
    thcText: potencyText(coa, 'thc'),
    cbdText: potencyText(coa, 'cbd'),
    analytes,
    marketCode: clean(payload.marketCode),
    isOnRecall: Boolean(payload.isOnRecall),
    pageText: JSON.stringify({
      productName,
      retailId,
      batchNumber,
      facilityName: payload.facilityName ?? null,
      facilityLicense: payload.facilityLicense ?? null,
      labName,
      labLicense,
      documentId,
      testedAt,
      marketCode: payload.marketCode ?? null,
      isOnRecall: Boolean(payload.isOnRecall),
    }),
    rawPayload: payload,
  };
}
