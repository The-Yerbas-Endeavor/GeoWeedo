import crypto from 'crypto';
import type { LabDiscoveryItem, LabProvider } from '../labIngestion';
import { fetchScLabsSample, ingestScLabsSample, isScLabsSampleUrl } from '../scLabs';

const USER_AGENT = 'GeoWeedo-WeedoFacts/0.1 (+https://geoweedo.com)';
const DEFAULT_SITEMAPS = [
  'https://client.sclabs.com/sitemap.xml',
  'https://client.sclabs.com/sitemap_index.xml',
];

function unique(values: string[]) { return [...new Set(values)]; }
function configuredUrls(name: string) {
  return String(process.env[name] || '').split(',').map(value => value.trim()).filter(Boolean);
}
function absolute(base: string, href: string) {
  try { return new URL(href, base).toString(); } catch { return null; }
}
function extractLocs(xml: string) {
  const out: string[] = [];
  const pattern = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) out.push(match[1].replace(/&amp;/g, '&').trim());
  return out;
}
function extractLinks(html: string, baseUrl: string) {
  const out: string[] = [];
  const pattern = /href=["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const url = absolute(baseUrl, match[1]);
    if (url) out.push(url);
  }
  return out;
}
function isScLabsPublicHost(input: string) {
  try { return new URL(input).hostname.toLowerCase() === 'client.sclabs.com'; } catch { return false; }
}
async function fetchText(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw new Error(`Discovery HTTP ${response.status} for ${url}`);
  return { text: await response.text(), type: response.headers.get('content-type') || '' };
}

async function discoverFromSitemaps(maxItems: number) {
  const samples = new Set<string>();
  const queue = unique([...configuredUrls('SC_LABS_SITEMAPS'), ...DEFAULT_SITEMAPS]);
  const visited = new Set<string>();
  while (queue.length && samples.size < maxItems && visited.size < 50) {
    const url = queue.shift()!;
    if (visited.has(url) || !isScLabsPublicHost(url)) continue;
    visited.add(url);
    try {
      const { text } = await fetchText(url);
      for (const loc of extractLocs(text)) {
        if (isScLabsSampleUrl(loc)) samples.add(loc);
        else if (/sitemap/i.test(loc) && isScLabsPublicHost(loc) && !visited.has(loc)) queue.push(loc);
        if (samples.size >= maxItems) break;
      }
    } catch {
      // SC Labs may not publish a global sitemap. Catalog discovery below remains available.
    }
  }
  return [...samples];
}

async function discoverFromCatalogs(maxItems: number) {
  const samples = new Set<string>();
  const seeds = unique([
    ...configuredUrls('SC_LABS_PUBLIC_CATALOG_URLS'),
    ...configuredUrls('SC_LABS_PUBLIC_SAMPLE_URLS'),
  ]);
  const queue = seeds.map(url => ({ url, depth: 0 }));
  const visited = new Set<string>();

  while (queue.length && samples.size < maxItems && visited.size < 250) {
    const current = queue.shift()!;
    if (visited.has(current.url) || !isScLabsPublicHost(current.url)) continue;
    visited.add(current.url);
    if (isScLabsSampleUrl(current.url)) {
      samples.add(current.url);
      continue;
    }
    try {
      const { text, type } = await fetchText(current.url);
      if (!type.includes('text/html')) continue;
      for (const link of extractLinks(text, current.url)) {
        if (!isScLabsPublicHost(link)) continue;
        if (isScLabsSampleUrl(link)) samples.add(link);
        else if (current.depth < 2 && !visited.has(link)) queue.push({ url: link, depth: current.depth + 1 });
        if (samples.size >= maxItems) break;
      }
    } catch {
      // One unavailable catalog must not stop the rest of discovery.
    }
  }
  return [...samples];
}

export async function discoverScLabsPublicSamples(options?: { maxItems?: number }): Promise<LabDiscoveryItem[]> {
  const maxItems = Math.max(1, Math.min(options?.maxItems || 500, 5000));
  const urls = unique([
    ...(await discoverFromSitemaps(maxItems)),
    ...(await discoverFromCatalogs(maxItems)),
  ]).slice(0, maxItems);
  return urls.map(sourceUrl => {
    const parsed = new URL(sourceUrl);
    const legacy = parsed.pathname.match(/\/sample\/(\d+)/i)?.[1];
    const externalId = legacy || crypto.createHash('sha256').update(sourceUrl).digest('hex');
    return { externalId, sourceUrl };
  });
}

function stableFingerprint(sample: any) {
  const payload = {
    sampleId: sample.sampleId,
    sourceUrl: sample.sourceUrl,
    productName: sample.productName,
    brandName: sample.brandName || null,
    productType: sample.productType || null,
    batchNumber: sample.batchNumber || null,
    uid: sample.uid || null,
    coaNumber: sample.coaNumber || null,
    coaUrl: sample.coaUrl || null,
    labLicenseNumber: sample.labLicenseNumber || null,
    producerName: sample.producerName || null,
    producerLicenseNumber: sample.producerLicenseNumber || null,
    collectedAt: sample.collectedAt || null,
    receivedAt: sample.receivedAt || null,
    testedAt: sample.testedAt || null,
    overallStatus: sample.overallStatus || null,
    analytes: sample.analytes || [],
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export const scLabsProvider: LabProvider = {
  id: 'sc-labs',
  name: 'SC Labs',
  discover: discoverScLabsPublicSamples,
  fetchAndNormalize: item => fetchScLabsSample(item.sourceUrl),
  fingerprint: stableFingerprint,
  ingest: ingestScLabsSample,
};
