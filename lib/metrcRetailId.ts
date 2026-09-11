import crypto from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema, type WeedoFactsRecord } from './weedoFacts';

export type MetrcRetailIdParsed = {
  sourceUrl: string;
  uid: string;
  productName: string;
  explicitProductName: boolean;
  brandName: string | null;
  productType: string | null;
  netContents: string | null;
  batchNumber: string | null;
  coaUrl: string | null;
  labName: string | null;
  labLicenseNumber: string | null;
  producerName: string | null;
  producerLicenseNumber: string | null;
  testedAt: string | null;
  overallStatus: string | null;
  cannabinoids: WeedoFactsRecord['cannabinoids'];
  terpenes: WeedoFactsRecord['terpenes'];
  safetyTests: WeedoFactsRecord['safetyTests'];
  pageText: string;
};

const RETAIL_ID_HOSTS = new Set(['1a4.com', 'www.1a4.com', 'app.1a4.com']);
const STOP_LABELS = ['Cultivar','Id','ID','Facility','License','Batch','Tested By','On','Lab License','Product','Product Name','Item','Brand','Category','Type','Ingredients','Cannabinoids','Terpenes','Lab Results','View Lab Report','Status'];

export function isMetrcRetailIdUrl(input: string) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && RETAIL_ID_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function extractMetrcRetailUid(input: string) {
  if (!isMetrcRetailIdUrl(input)) return null;
  const url = new URL(input);
  const landing = decodeURIComponent(url.pathname).match(/\/landingpage\/(1a4[a-z0-9]{21})(?:\/|$)/i)?.[1];
  if (landing) return landing.toUpperCase();
  const anyUid = decodeURIComponent(url.pathname).match(/\b(1a4[a-z0-9]{21})\b/i)?.[1];
  return anyUid ? anyUid.toUpperCase() : null;
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function htmlText(html: string) {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' | ')
    .replace(/<\/(?:div|p|li|tr|section|article|h\d)>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*/g, ' | ')
    .trim();
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

function firstText(root: any, keys: string[]) {
  const wanted = new Set(keys.map(key => key.toLowerCase().replace(/[^a-z0-9]/g, '')));
  let found: string | null = null;
  walk(root, (key, value) => {
    if (found || !['string','number'].includes(typeof value)) return;
    if (!wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return;
    const text = String(value).trim();
    if (text) found = text;
  });
  return found;
}

function captureLabel(pageText: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stops = STOP_LABELS.filter(item => !labels.includes(item)).map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const match = pageText.match(new RegExp(`(?:^|\\|)\\s*${escaped}\\s*:?\\s*([^|]{1,180}?)(?=\\s*(?:\\||${stops}\\s*:|$))`, 'i'));
    const value = match?.[1]?.trim().replace(/^[\-–—:]\s*/, '').trim();
    if (value) return value;
  }
  return null;
}

function firstHref(html: string, sourceUrl: string, predicates: Array<(href: string, text: string) => boolean>) {
  const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const href = decodeEntities(match[1]).trim();
    const text = htmlText(match[2]);
    if (!predicates.some(predicate => predicate(href, text))) continue;
    try { return new URL(href, sourceUrl).toString(); } catch {}
  }
  return null;
}

function numberValue(value: string) {
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractChemistry(pageText: string) {
  const cannabinoids: WeedoFactsRecord['cannabinoids'] = [];
  const terpenes: WeedoFactsRecord['terpenes'] = [];
  const seen = new Set<string>();
  const push = (group: 'cannabinoid'|'terpene', name: string, value: number | null, unit: string | null) => {
    const key = `${group}|${name.toLowerCase()}|${value}|${unit}`;
    if (seen.has(key)) return;
    seen.add(key);
    (group === 'cannabinoid' ? cannabinoids : terpenes).push({ name, value, unit });
  };

  const cannabinoidNames = ['Total Cannabinoids','Total THC','Total CBD','Delta 9-THC','Delta-9 THC','THCa','THC','CBDa','CBD','CBGa','CBG','CBCa','CBC','CBN','THCV','CBDV'];
  for (const name of cannabinoidNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = pageText.match(new RegExp(`\\b${escaped}\\b\\s*:?\\s*(-?\\d+(?:\\.\\d+)?)\\s*(%|mg(?:\\/srv|\\/serving|\\/package)?)`, 'i'));
    if (match) push('cannabinoid', name, numberValue(match[1]), match[2].replace(/srv/i, 'serving'));
  }
  const perAmount = /(-?\d+(?:\.\d+)?)\s*MG\s+(THC|CBD)\s+PER\s+(SERVING|PACKAGE)/gi;
  let amountMatch: RegExpExecArray | null;
  while ((amountMatch = perAmount.exec(pageText)) !== null) push('cannabinoid', `${amountMatch[2].toUpperCase()} per ${amountMatch[3].toLowerCase()}`, numberValue(amountMatch[1]), 'mg');

  const terpeneNames = ['Total Terpenes','α-Pinene','Beta-Pinene','β-Pinene','Myrcene','β-Myrcene','Limonene','Linalool','α-Humulene','β-Caryophyllene','Caryophyllene Oxide','Terpinolene','Fenchol','Ocimene','Camphene','Geraniol','Guaiol','α-Bisabolol','Nerolidol','Borneol','Eucalyptol'];
  for (const name of terpeneNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = pageText.match(new RegExp(`(?:^|\\s)${escaped}\\s*:?\\s*(-?\\d+(?:\\.\\d+)?)\\s*(%)`, 'i'));
    if (match) push('terpene', name, numberValue(match[1]), '%');
  }
  return { cannabinoids, terpenes };
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export async function fetchMetrcRetailId(sourceUrl: string): Promise<MetrcRetailIdParsed> {
  const uidFromUrl = extractMetrcRetailUid(sourceUrl);
  if (!uidFromUrl) throw new Error('Expected a Metrc Retail ID / 1a4 landing-page URL with a package UID.');
  const response = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'GeoWeedo-WeedoFacts/0.4 (+https://geoweedo.com)', Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Metrc Retail ID returned HTTP ${response.status}.`);
  const html = await response.text();
  if (!html.trim()) throw new Error('Metrc Retail ID returned an empty page.');
  const docs = extractJsonDocuments(html);
  const pageText = htmlText(html);
  const structuredProductName = firstText(docs, ['productName','product_name','itemName','item_name','product','item']);
  const labeledProductName = captureLabel(pageText, ['Product Name','Product','Item']);
  const cultivar = firstText(docs, ['cultivar','strainName','strain_name']) || captureLabel(pageText, ['Cultivar']);
  const productName = structuredProductName || labeledProductName || cultivar || `Retail ID ${uidFromUrl.slice(-8)}`;
  const explicitProductName = Boolean(structuredProductName || labeledProductName);
  const brandName = firstText(docs, ['brandName','brand_name','brand']) || captureLabel(pageText, ['Brand']);
  const producerName = firstText(docs, ['facilityName','facility_name','facility','producerName','producer_name','manufacturerName','manufacturer_name']) || captureLabel(pageText, ['Facility']);
  const producerLicenseNumber = firstText(docs, ['facilityLicense','facility_license','producerLicense','producer_license','licenseNumber','license_number']) || captureLabel(pageText, ['License']);
  const batchNumber = firstText(docs, ['batchNumber','batch_number','batch','lotNumber','lot_number']) || captureLabel(pageText, ['Batch']);
  const labName = firstText(docs, ['labName','lab_name','testingLab','testing_lab']) || captureLabel(pageText, ['Tested By']);
  const labLicenseNumber = firstText(docs, ['labLicense','lab_license','labLicenseNumber','lab_license_number']) || captureLabel(pageText, ['Lab License']);
  const testedAt = normalizeDate(firstText(docs, ['testedAt','tested_at','testDate','test_date','dateTested','date_tested']) || captureLabel(pageText, ['On']));
  const overallStatus = firstText(docs, ['overallStatus','overall_status','complianceStatus','compliance_status','status']) || captureLabel(pageText, ['Status']);
  const productType = firstText(docs, ['productType','product_type','category','itemCategory','item_category']) || captureLabel(pageText, ['Category','Type']);
  const netContents = firstText(docs, ['netContents','net_contents','packageSize','package_size','quantity']);
  const coaUrl = firstHref(html, response.url || sourceUrl, [
    (href, text) => /view\s+lab\s+report/i.test(text),
    (href, text) => /\bcoa\b/i.test(text),
    href => /\.pdf(?:$|[?#])/i.test(href),
  ]);
  const chemistry = extractChemistry(pageText);
  return {
    sourceUrl,
    uid: (firstText(docs, ['uid','retailId','retail_id','packageTag','package_tag','id']) || captureLabel(pageText, ['Id','ID']) || uidFromUrl).toUpperCase(),
    productName,
    explicitProductName,
    brandName,
    productType,
    netContents,
    batchNumber,
    coaUrl,
    labName,
    labLicenseNumber,
    producerName,
    producerLicenseNumber,
    testedAt,
    overallStatus,
    cannabinoids: chemistry.cannabinoids,
    terpenes: chemistry.terpenes,
    safetyTests: [],
    pageText,
  };
}

function productForParsed(parsed: MetrcRetailIdParsed) {
  const db = getDatabase();
  const normalized = `${parsed.brandName || ''} ${parsed.productName}`.trim().toLowerCase();
  let product = db.prepare('SELECT * FROM cannabis_products WHERE normalized_name=? LIMIT 1').get(normalized) as any;
  if (!product && !parsed.brandName) product = db.prepare(`SELECT * FROM cannabis_products WHERE brand_name IS NULL AND product_name=? COLLATE NOCASE LIMIT 1`).get(parsed.productName) as any;
  if (product) return product;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO cannabis_products (id,brand_name,product_name,product_type,net_contents,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, parsed.brandName, parsed.productName, parsed.productType, parsed.netContents, normalized, now, now);
  return db.prepare('SELECT * FROM cannabis_products WHERE id=?').get(id) as any;
}

export function ingestMetrcRetailId(parsed: MetrcRetailIdParsed) {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const existingByUid = db.prepare('SELECT * FROM cannabis_batches WHERE uid=? COLLATE NOCASE LIMIT 1').get(parsed.uid) as any;
  if (existingByUid) return { batchId: existingByUid.id as string, productId: existingByUid.product_id as string, created: false, preservedExisting: true };
  if (!parsed.explicitProductName) return { batchId: null, productId: null, created: false, preservedExisting: false, reason: 'Retail ID page did not expose an explicit product/item name.' };

  const product = productForParsed(parsed);
  if (parsed.batchNumber) {
    const stronger = db.prepare(`SELECT * FROM cannabis_batches WHERE product_id=? AND batch_number=? COLLATE NOCASE AND source_type='lab' AND verified=1 LIMIT 1`).get(product.id, parsed.batchNumber) as any;
    if (stronger) {
      if (!stronger.uid) db.prepare('UPDATE cannabis_batches SET uid=?,updated_at=? WHERE id=?').run(parsed.uid, new Date().toISOString(), stronger.id);
      return { batchId: stronger.id as string, productId: product.id as string, created: false, preservedExisting: true };
    }
  }

  const now = new Date().toISOString();
  const batchId = `metrc-${crypto.createHash('sha256').update(parsed.uid).digest('hex').slice(0,24)}`;
  db.prepare(`INSERT INTO cannabis_batches (id,product_id,batch_number,uid,coa_url,lab_name,lab_license_number,producer_name,producer_license_number,tested_at,overall_status,source_type,source_name,source_url,verified,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(batchId, product.id, parsed.batchNumber, parsed.uid, parsed.coaUrl, parsed.labName, parsed.labLicenseNumber, parsed.producerName, parsed.producerLicenseNumber, parsed.testedAt, parsed.overallStatus, 'regulatory_public', 'Metrc Retail ID', parsed.sourceUrl, 1, now, now);
  const insertAnalyte = db.prepare(`INSERT INTO cannabis_analytes (id,batch_id,group_name,analyte_name,value,unit,lod,loq,status,limit_value,limit_unit,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of parsed.cannabinoids) insertAnalyte.run(crypto.randomUUID(), batchId, 'cannabinoid', row.name, row.value, row.unit, row.lod ?? null, row.loq ?? null, null, null, null, now);
  for (const row of parsed.terpenes) insertAnalyte.run(crypto.randomUUID(), batchId, 'terpene', row.name, row.value, row.unit, row.lod ?? null, row.loq ?? null, null, null, null, now);
  db.prepare(`INSERT OR IGNORE INTO cannabis_batch_identifiers (id,batch_id,identifier_type,identifier_value,verified,created_at) VALUES (?,?,?,?,1,?)`).run(crypto.randomUUID(), batchId, 'uid', parsed.uid, now);
  db.prepare(`INSERT OR IGNORE INTO cannabis_batch_identifiers (id,batch_id,identifier_type,identifier_value,verified,created_at) VALUES (?,?,?,?,1,?)`).run(crypto.randomUUID(), batchId, 'qr', parsed.sourceUrl, now);
  db.prepare(`INSERT INTO cannabis_coa_sources (id,batch_id,source_type,source_name,source_url,external_id,raw_payload_json,parser_version,fetched_at,verified,created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)`)
    .run(crypto.randomUUID(), batchId, 'regulatory_public', 'Metrc Retail ID', parsed.sourceUrl, parsed.uid, JSON.stringify({ uid: parsed.uid, productName: parsed.productName, brandName: parsed.brandName, batchNumber: parsed.batchNumber, labName: parsed.labName, testedAt: parsed.testedAt }), 'metrc-retail-id-v1', now, now);
  return { batchId, productId: product.id as string, created: true, preservedExisting: false };
}

export function metrcRetailIdPreview(parsed: MetrcRetailIdParsed): WeedoFactsRecord {
  return {
    productId: '',
    batchId: null,
    brandName: parsed.brandName,
    productName: parsed.productName,
    productType: parsed.productType,
    netContents: parsed.netContents,
    matchLevel: 'source_backed',
    batchNumber: parsed.batchNumber,
    uid: parsed.uid,
    coaNumber: null,
    coaUrl: parsed.coaUrl,
    labName: parsed.labName,
    labLicenseNumber: parsed.labLicenseNumber,
    producerName: parsed.producerName,
    producerLicenseNumber: parsed.producerLicenseNumber,
    testedAt: parsed.testedAt,
    collectedAt: null,
    receivedAt: null,
    overallStatus: parsed.overallStatus,
    cannabinoids: parsed.cannabinoids,
    terpenes: parsed.terpenes,
    safetyTests: parsed.safetyTests,
    source: { type: 'regulatory_public', name: 'Metrc Retail ID', url: parsed.sourceUrl, verified: true },
  };
}
