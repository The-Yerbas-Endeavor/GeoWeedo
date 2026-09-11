import 'server-only';

export type RetailId1A4Record = {
  url: string;
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
  testedAt: string | null;
  overallStatus: string | null;
  coaUrl: string | null;
  thcText: string | null;
  cbdText: string | null;
  pageText: string;
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

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlToText(html: string) {
  return decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/tr>|<\/h[1-6]>|<\/section>|<\/article>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value.replace(/\s{2,}/g, ' ');
  }
  return null;
}

function extractJsonDocuments(html: string) {
  const docs: any[] = [];
  const patterns = [
    /<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi,
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      try { docs.push(JSON.parse(decodeEntities(match[1]))); } catch {}
    }
  }
  return docs;
}

function walk(value: any, visit: (key: string, value: any) => void) {
  if (Array.isArray(value)) { for (const item of value) walk(item, visit); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { visit(key, child); walk(child, visit); }
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

function absoluteUrl(base: string, candidate: string | null) {
  if (!candidate) return null;
  try { return new URL(candidate, base).toString(); } catch { return null; }
}

function extractCoaUrl(html: string, base: string) {
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for (const match of anchors) {
    const href = decodeEntities(match[1]);
    const label = htmlToText(match[2]);
    if (/view\s+lab\s+report|certificate|\bcoa\b/i.test(label) || /(?:coa|certificate|lab|test).*(?:\.pdf|download)|\.pdf(?:\?|$)/i.test(href)) {
      return absoluteUrl(base, href);
    }
  }
  const pdf = [...html.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)][0]?.[1] || null;
  return absoluteUrl(base, pdf ? decodeEntities(pdf) : null);
}

function extractTitle(html: string, text: string) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
  if (og && !/retail\s*id|metrc\s*verif/i.test(og)) return decodeEntities(og).trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title && !/retail\s*id|metrc\s*verif/i.test(title)) return decodeEntities(title.replace(/<[^>]+>/g, ' ')).trim();
  return firstMatch(text, [/(?:Product Name|Product|Item)\s*:\s*([^\n]+)/i]);
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export async function fetchRetailId1A4(value: string): Promise<RetailId1A4Record> {
  if (!isRetailId1A4Url(value)) throw new Error('Unsupported Retail ID URL.');
  const input = new URL(value);
  const uidFromPath = retailIdFrom1A4Url(value);
  const response = await fetch(input.toString(), {
    cache: 'no-store',
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'GeoWeedo/1.0 (+https://geoweedo.com)',
    },
  });
  if (!response.ok) throw new Error(`Retail ID page returned ${response.status}.`);
  const finalUrl = response.url || input.toString();
  const html = await response.text();
  if (!html || html.length > 2_000_000) throw new Error('Retail ID page could not be read safely.');
  const text = htmlToText(html);
  const docs = extractJsonDocuments(html);
  const parts = input.pathname.split('/').filter(Boolean);
  const serial = parts[2] || null;
  const retailId = firstJsonText(docs, ['retailId', 'retail_id', 'packageUid', 'package_uid', 'packageTag', 'package_tag', 'uid'])
    || firstMatch(text, [
      /(?:Metrc\s*(?:ID|Id)|Retail\s*ID|Id)\s*:\s*(1A4[A-Z0-9]{21})/i,
      /\b(1A4[A-Z0-9]{21})\b/i,
    ])
    || uidFromPath;

  const title = extractTitle(html, text);
  const structuredProductName = firstJsonText(docs, ['productName', 'product_name', 'itemName', 'item_name']);
  const labeledProductName = firstMatch(text, [/(?:Product Name|Product|Item)\s*:\s*([^\n]+)/i]);
  const productName = structuredProductName || labeledProductName || title;
  const cultivar = firstJsonText(docs, ['cultivar', 'strainName', 'strain_name']) || firstMatch(text, [/(?:Cultivar|Strain)\s*:\s*([^\n]+)/i]);

  return {
    url: finalUrl,
    retailId: retailId ? retailId.toUpperCase() : uidFromPath,
    serial,
    title,
    productName: productName || cultivar,
    explicitProductName: Boolean(structuredProductName || labeledProductName || title),
    brandName: firstJsonText(docs, ['brandName', 'brand_name', 'brand']) || firstMatch(text, [/(?:Brand)\s*:\s*([^\n]+)/i]),
    productType: firstJsonText(docs, ['productType', 'product_type', 'category', 'itemCategory', 'item_category']) || firstMatch(text, [/(?:Product Type|Category|Type)\s*:\s*([^\n]+)/i]),
    netContents: firstJsonText(docs, ['netContents', 'net_contents', 'packageSize', 'package_size', 'quantity']) || firstMatch(text, [/(?:Net Contents|Package Size|Quantity)\s*:\s*([^\n]+)/i]),
    cultivar,
    batchNumber: firstJsonText(docs, ['batchNumber', 'batch_number', 'batch', 'lotNumber', 'lot_number']) || firstMatch(text, [/(?:Batch|Lot)\s*:\s*([^\n]+)/i]),
    facility: firstJsonText(docs, ['facilityName', 'facility_name', 'facility', 'producerName', 'producer_name', 'manufacturerName', 'manufacturer_name']) || firstMatch(text, [/(?:Facility|Produced By|Manufactured By|Processor)\s*:\s*([^\n]+)/i]),
    facilityLicense: firstJsonText(docs, ['facilityLicense', 'facility_license', 'producerLicense', 'producer_license']) || firstMatch(text, [/(?:Facility License|License)\s*:\s*([A-Z0-9-]+)/i]),
    labName: firstJsonText(docs, ['labName', 'lab_name', 'testingLab', 'testing_lab']) || firstMatch(text, [/(?:Tested By|Lab(?:oratory)?)\s*:\s*([^\n]+)/i]),
    labLicense: firstJsonText(docs, ['labLicense', 'lab_license', 'labLicenseNumber', 'lab_license_number']) || firstMatch(text, [/(?:Lab License)\s*:\s*([A-Z0-9-]+)/i]),
    testedAt: normalizeDate(firstJsonText(docs, ['testedAt', 'tested_at', 'testDate', 'test_date', 'dateTested', 'date_tested']) || firstMatch(text, [/(?:Tested (?:On|Date)|On)\s*:\s*([^\n]+)/i])),
    overallStatus: firstJsonText(docs, ['overallStatus', 'overall_status', 'complianceStatus', 'compliance_status']) || firstMatch(text, [/(?:Compliance Status|Status)\s*:\s*([^\n]+)/i]),
    coaUrl: extractCoaUrl(html, finalUrl),
    thcText: firstMatch(text, [/(?:Total\s+)?THC\s*:?\s*([^\n]+)/i, /(\d+(?:\.\d+)?\s*MG\s+THC\s+PER\s+(?:PACKAGE|SERVING))/i]),
    cbdText: firstMatch(text, [/(?:Total\s+)?CBD\s*:?\s*([^\n]+)/i, /(\d+(?:\.\d+)?\s*MG\s+CBD\s+PER\s+(?:PACKAGE|SERVING))/i]),
    pageText: text.slice(0, 12000),
  };
}
