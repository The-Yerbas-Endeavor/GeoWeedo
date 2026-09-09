import crypto from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';

type AnyRecord = Record<string, any>;

export type ScLabsNormalizedSample = {
  sampleId: string;
  sourceUrl: string;
  productName: string;
  brandName?: string | null;
  productType?: string | null;
  batchNumber?: string | null;
  uid?: string | null;
  coaNumber?: string | null;
  coaUrl?: string | null;
  labName: string;
  labLicenseNumber?: string | null;
  producerName?: string | null;
  producerLicenseNumber?: string | null;
  collectedAt?: string | null;
  receivedAt?: string | null;
  testedAt?: string | null;
  overallStatus?: string | null;
  state?: string | null;
  analytes: Array<{
    groupName: string;
    analyteName: string;
    value: number | null;
    unit: string | null;
    lod?: number | null;
    loq?: number | null;
    status?: string | null;
    limitValue?: number | null;
    limitUnit?: string | null;
  }>;
  raw: AnyRecord;
};

function walk(value: any, visit: (key: string, value: any, parent: AnyRecord | null) => void, parent: AnyRecord | null = null) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, parent);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    visit(key, child, value);
    walk(child, visit, value);
  }
}

function firstText(root: any, keys: string[]) {
  let found: string | null = null;
  const wanted = new Set(keys.map(k => k.toLowerCase()));
  walk(root, (key, value) => {
    if (found || !wanted.has(key.toLowerCase()) || !['string', 'number'].includes(typeof value)) return;
    const text = String(value).trim();
    if (text) found = text;
  });
  return found;
}

function asNumber(value: any) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned || /^n\/?a$/i.test(cleaned) || /^nd$/i.test(cleaned) || /^<\s*lod$/i.test(cleaned)) return null;
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function classifyGroup(text: string) {
  const value = text.toLowerCase();
  if (value.includes('cannabinoid') || value.includes('potency')) return 'cannabinoid';
  if (value.includes('terpen')) return 'terpene';
  if (value.includes('pestic')) return 'pesticide';
  if (value.includes('heavy metal') || value.includes('metal')) return 'heavy_metal';
  if (value.includes('microb')) return 'microbial';
  if (value.includes('mycotoxin')) return 'mycotoxin';
  if (value.includes('solvent') || value.includes('processing chemical')) return 'residual_solvent';
  if (value.includes('moisture')) return 'moisture';
  if (value.includes('water activity')) return 'water_activity';
  if (value.includes('foreign')) return 'foreign_material';
  return 'other';
}

function firstOwn(row: AnyRecord, keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  return undefined;
}
function textOwn(row: AnyRecord, keys: string[]) {
  const value = firstOwn(row, keys);
  return value === undefined ? null : String(value).trim() || null;
}

function extractAnalytes(root: any) {
  const rows: ScLabsNormalizedSample['analytes'] = [];
  const seen = new Set<string>();
  walk(root, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const row = value as AnyRecord;
    const name = firstOwn(row, ['analyteName','analyte_name','analyte','compoundName','compound_name','name']);
    const rawResult = firstOwn(row, ['result','resultValue','result_value','value','concentration','amount']);
    if (!name || rawResult === undefined) return;
    const context = [firstOwn(row,['testName','test_name','analysis','category','group','panel']), name].filter(Boolean).join(' ');
    const unit = textOwn(row,['unit','units','uom','resultUnit','result_unit']);
    const status = textOwn(row,['status','resultStatus','result_status','passFail','pass_fail']);
    const groupName = classifyGroup(context);
    const key = `${groupName}|${String(name).toLowerCase()}|${String(rawResult)}|${unit || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ groupName, analyteName: String(name).trim(), value: asNumber(rawResult), unit,
      lod: asNumber(firstOwn(row,['lod','limitOfDetection','limit_of_detection'])),
      loq: asNumber(firstOwn(row,['loq','limitOfQuantitation','limit_of_quantitation'])),
      status,
      limitValue: asNumber(firstOwn(row,['actionLimit','action_limit','limit','limitValue','limit_value'])),
      limitUnit: textOwn(row,['limitUnit','limit_unit','actionLimitUnit','action_limit_unit']) || unit });
  });
  return rows;
}

function extractJsonDocuments(html: string) {
  const docs: any[] = [];
  const scriptPattern = /<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(html)) !== null) {
    try { docs.push(JSON.parse(match[1])); } catch {}
  }
  const next = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (next) try { docs.push(JSON.parse(next[1])); } catch {}
  return docs;
}

function htmlText(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

function capture(pageText: string, label: string) {
  const re = new RegExp(`${label}\\s*:?\\s*([^|]{1,160}?)(?=\\s+(?:Sample Type|Business Name|License Number|Sample ID|Date Collected|Date Issued|Cannabinoids|Terpenoids|Moisture|Class|$))`, 'i');
  return pageText.match(re)?.[1]?.trim() || null;
}

function cleanPhytofactsProductName(value: string | null) {
  if (!value) return null;
  const cleaned = value.replace(/\s*\([^)]*\bC-\d+(?:\.\d+)?%[^)]*\)\s*.*$/i, '').replace(/\s+Powered By\b.*$/i, '').replace(/\s+General\b.*$/i, '').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function productNameFromPhytofacts(pageText: string) {
  const heading = pageText.match(/^(.{2,180}?)(?=\s+General\s+Cannabinoids\b)/i)?.[1]?.trim() || null;
  if (!heading) return null;
  const poweredIndex = heading.search(/\s+Powered By\b/i);
  const left = poweredIndex >= 0 ? heading.slice(0, poweredIndex).trim() : heading;
  const withoutStats = left.replace(/\s*\([^)]*\bC-\d+(?:\.\d+)?%[^)]*\)\s*$/i, '').trim();
  const words = withoutStats.split(/\s+/);
  if (words.length >= 2) {
    for (let width = Math.min(8, Math.floor(words.length / 2)); width >= 1; width--) {
      const tail = words.slice(-width).join(' ');
      const previous = words.slice(-width * 2, -width).join(' ');
      if (previous && tail.toLowerCase() === previous.toLowerCase()) return tail;
    }
  }
  return cleanPhytofactsProductName(withoutStats);
}

const TERPENES = ['terpinolene','α-phellandrene','alpha-phellandrene','β-phellandrene','beta-phellandrene','β-ocimene','beta-ocimene','carene','limonene','γ-terpinene','gamma-terpinene','α-pinene','alpha-pinene','α-terpinene','alpha-terpinene','β-pinene','beta-pinene','fenchol','camphene','α-terpineol','alpha-terpineol','α-humulene','alpha-humulene','β-caryophyllene','beta-caryophyllene','linalool','caryophyllene oxide','myrcene','bisabolol','borneol','camphor','eucalyptol','guaiol','isopulegol','nerolidol','pulegone'];

function pushUnique(out: ScLabsNormalizedSample['analytes'], seen: Set<string>, row: ScLabsNormalizedSample['analytes'][number]) {
  const key = `${row.groupName}|${row.analyteName.toLowerCase()}|${row.value ?? ''}|${row.unit ?? ''}|${row.status ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(row);
}

function phytofactsAnalytes(pageText: string) {
  const out: ScLabsNormalizedSample['analytes'] = [];
  const seen = new Set<string>();
  const cannabinoidSection = pageText.match(/Cannabinoids\s+Ratio of top two cannabinoids\s*\|?\s*Cannabinoids Weight %\s+([\s\S]*?)(?:Aroma & Flavor|PhytoPrint|Copyright|$)/i)?.[1] || pageText;
  const cannabinoidPattern = /\b(THCA|THCVA|THCV|THC|CBDA|CBDVA|CBDV|CBD|CBGA|CBG|CBCA|CBC)\s+(-?\d+(?:\.\d+)?)%/gi;
  let cannabinoidMatch: RegExpExecArray | null;
  while ((cannabinoidMatch = cannabinoidPattern.exec(cannabinoidSection)) !== null) {
    pushUnique(out, seen, { groupName: 'cannabinoid', analyteName: cannabinoidMatch[1].toUpperCase(), value: Number(cannabinoidMatch[2]), unit: '%' });
  }
  for (const name of TERPENES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = pageText.match(new RegExp(`(?:^|\\s)(${escaped})\\s+(-?\\d+(?:\\.\\d+)?)%`, 'i'));
    if (match) pushUnique(out, seen, { groupName: 'terpene', analyteName: match[1], value: Number(match[2]), unit: '%' });
  }
  const totals: Array<[string,string]> = [['Total Cannabinoids','Cannabinoids'],['Total Terpenoids','Terpenoids'],['Moisture','Moisture']];
  for (const [analyteName,label] of totals) {
    const match = pageText.match(new RegExp(`${label}\\s*:?\\s*(-?\\d+(?:\\.\\d+)?)%`, 'i'));
    if (match) pushUnique(out, seen, { groupName: label === 'Terpenoids' ? 'terpene' : label === 'Moisture' ? 'moisture' : 'cannabinoid', analyteName, value: Number(match[1]), unit: '%' });
  }
  const complianceGroups: Array<[string,string[]]> = [['pesticide',['Pesticides','Pesticide']],['heavy_metal',['Heavy Metals','Heavy Metal']],['microbial',['Microbials','Microbial Impurities','Microbial']],['mycotoxin',['Mycotoxins','Mycotoxin']],['residual_solvent',['Residual Solvents','Residual Solvent','Processing Chemicals']],['foreign_material',['Foreign Material']],['water_activity',['Water Activity']]];
  for (const [groupName,labels] of complianceGroups) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = pageText.match(new RegExp(`${escaped}\\s*(?:Result|Status)?\\s*:?\\s*(PASS|PASSED|FAIL|FAILED|NOT TESTED|NT)\\b`, 'i'));
      if (match) { pushUnique(out, seen, { groupName, analyteName: label, value: null, unit: null, status: match[1].toUpperCase() }); break; }
    }
  }
  return out;
}

export function isScLabsSampleUrl(input: string) {
  try { const url = new URL(input); if (!/(^|\.)sclabs\.com$/i.test(url.hostname)) return false; return /\/sample\/\d+\/?$/i.test(url.pathname) || /\/phytofacts\/?$/i.test(url.pathname); } catch { return false; }
}

export async function fetchScLabsSample(sourceUrl: string): Promise<ScLabsNormalizedSample> {
  if (!isScLabsSampleUrl(sourceUrl)) throw new Error('Expected an SC Labs public sample or PhytoFacts URL.');
  const response = await fetch(sourceUrl, { headers: { 'User-Agent': 'GeoWeedo-WeedoFacts/0.1 (+https://geoweedo.com)' }, redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw new Error(`SC Labs returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error(`Unexpected SC Labs content type: ${contentType || 'unknown'}.`);
  const html = await response.text();
  const docs = extractJsonDocuments(html);
  const pageText = htmlText(html);
  const raw = { documents: docs, pageText };
  const data = raw;
  const legacyId = new URL(sourceUrl).pathname.match(/\/sample\/(\d+)/i)?.[1] || null;
  const visibleSampleId = capture(pageText, 'Sample ID');
  const sampleId = firstText(data,['sampleId','sample_id']) || visibleSampleId || legacyId || crypto.createHash('sha256').update(sourceUrl).digest('hex').slice(0,16);
  const structuredProductName = firstText(data, ['sampleName','sample_name','productName','product_name']);
  const productName = cleanPhytofactsProductName(structuredProductName) || productNameFromPhytofacts(pageText) || pageText.match(/SC Labs\s*\|\s*PhytoFacts[^-]*-\s*([^|]{2,120})/i)?.[1]?.trim();
  if (!productName) throw new Error('SC Labs page loaded, but GeoWeedo could not identify the product name. Adapter needs a parser update for this page shape.');
  const structuredAnalytes = extractAnalytes(data);
  const pageAnalytes = phytofactsAnalytes(pageText);
  const analytes: ScLabsNormalizedSample['analytes'] = [];
  const seen = new Set<string>();
  for (const row of [...structuredAnalytes, ...pageAnalytes]) pushUnique(analytes, seen, row);
  return { sampleId, sourceUrl, productName,
    brandName: firstText(data,['companyName','company_name','brandName','brand_name','clientName','client_name']) || capture(pageText,'Business Name'),
    productType: firstText(data,['matrixType','matrix_type','sampleType','sample_type','productType','product_type']) || capture(pageText,'Sample Type'),
    batchNumber: firstText(data,['batchNumber','batch_number','batch','lotNumber','lot_number']),
    uid: firstText(data,['uid','metrcUid','metrc_uid','trackAndTraceUid','track_and_trace_uid']),
    coaNumber: firstText(data,['coaNumber','coa_number','certificateNumber','certificate_number']) || sampleId,
    coaUrl: firstText(data,['coaUrl','coa_url','certificateUrl','certificate_url']), labName: 'SC Labs',
    labLicenseNumber: firstText(data,['labLicenseNumber','lab_license_number']),
    producerName: firstText(data,['producerName','producer_name','cultivatorName','cultivator_name','manufacturerName','manufacturer_name']) || capture(pageText,'Business Name'),
    producerLicenseNumber: firstText(data,['producerLicenseNumber','producer_license_number','clientLicenseNumber','client_license_number']) || capture(pageText,'License Number'),
    collectedAt: firstText(data,['collectedAt','collected_at','collectionDate','collection_date','dateCollected','date_collected']) || capture(pageText,'Date Collected'),
    receivedAt: firstText(data,['receivedAt','received_at','receivedDate','received_date','dateReceived','date_received']),
    testedAt: firstText(data,['testedAt','tested_at','completedAt','completed_at','issueDate','issue_date','dateIssued','date_issued']) || capture(pageText,'Date Issued'),
    overallStatus: firstText(data,['overallStatus','overall_status','resultStatus','result_status','status']), state: firstText(data,['state','stateCode','state_code']) || 'CA', analytes, raw };
}

export function ingestScLabsSample(sample: ScLabsNormalizedSample) {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const now = new Date().toISOString();
  const normalized = `${sample.brandName || ''} ${sample.productName}`.trim().toLowerCase();
  let product = db.prepare(`SELECT * FROM cannabis_products WHERE normalized_name=? LIMIT 1`).get(normalized) as any;
  if (!product) { const id = `cp-${crypto.randomUUID()}`; db.prepare(`INSERT INTO cannabis_products (id,brand_name,product_name,product_type,net_contents,normalized_name,created_at,updated_at) VALUES (?,?,?,?,NULL,?,?,?)`).run(id,sample.brandName || null,sample.productName,sample.productType || null,normalized,now,now); product = { id }; }
  const existing = db.prepare(`SELECT * FROM cannabis_batches WHERE source_type='lab' AND source_name='SC Labs' AND coa_number=? LIMIT 1`).get(sample.coaNumber || sample.sampleId) as any;
  const batchId = existing?.id || `cb-${crypto.randomUUID()}`;
  if (!existing) { db.prepare(`INSERT INTO cannabis_batches (id,product_id,batch_number,uid,coa_number,coa_url,lab_name,lab_license_number,producer_name,producer_license_number,collected_at,received_at,tested_at,overall_status,source_type,source_name,source_url,verified,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'lab','SC Labs',?,1,?,?)`).run(batchId,product.id,sample.batchNumber || null,sample.uid || null,sample.coaNumber || sample.sampleId,sample.coaUrl || sample.sourceUrl,'SC Labs',sample.labLicenseNumber || null,sample.producerName || sample.brandName || null,sample.producerLicenseNumber || null,sample.collectedAt || null,sample.receivedAt || null,sample.testedAt || null,sample.overallStatus || null,sample.sourceUrl,now,now); }
  else { db.prepare(`UPDATE cannabis_batches SET product_id=?,batch_number=COALESCE(?,batch_number),uid=COALESCE(?,uid),coa_url=COALESCE(?,coa_url),lab_license_number=COALESCE(?,lab_license_number),producer_name=COALESCE(?,producer_name),producer_license_number=COALESCE(?,producer_license_number),collected_at=COALESCE(?,collected_at),received_at=COALESCE(?,received_at),tested_at=COALESCE(?,tested_at),overall_status=COALESCE(?,overall_status),source_url=?,verified=1,updated_at=? WHERE id=?`).run(product.id,sample.batchNumber || null,sample.uid || null,sample.coaUrl || sample.sourceUrl,sample.labLicenseNumber || null,sample.producerName || sample.brandName || null,sample.producerLicenseNumber || null,sample.collectedAt || null,sample.receivedAt || null,sample.testedAt || null,sample.overallStatus || null,sample.sourceUrl,now,batchId); db.prepare('DELETE FROM cannabis_analytes WHERE batch_id=?').run(batchId); }
  const addIdentifier = db.prepare(`INSERT OR IGNORE INTO cannabis_batch_identifiers (id,batch_id,identifier_type,identifier_value,verified,created_at) VALUES (?,?,?,?,1,?)`);
  addIdentifier.run(`cbi-${crypto.randomUUID()}`,batchId,'coa',sample.coaNumber || sample.sampleId,now); addIdentifier.run(`cbi-${crypto.randomUUID()}`,batchId,'qr',sample.sourceUrl,now); if (sample.batchNumber) addIdentifier.run(`cbi-${crypto.randomUUID()}`,batchId,'batch',sample.batchNumber,now); if (sample.uid) addIdentifier.run(`cbi-${crypto.randomUUID()}`,batchId,'uid',sample.uid,now);
  const insertAnalyte = db.prepare(`INSERT INTO cannabis_analytes (id,batch_id,group_name,analyte_name,value,unit,lod,loq,status,limit_value,limit_unit,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of sample.analytes) insertAnalyte.run(`ca-${crypto.randomUUID()}`,batchId,row.groupName,row.analyteName,row.value,row.unit,row.lod ?? null,row.loq ?? null,row.status ?? null,row.limitValue ?? null,row.limitUnit ?? null,now);
  db.prepare(`INSERT INTO cannabis_coa_sources (id,batch_id,source_type,source_name,source_url,external_id,raw_payload_json,parser_version,fetched_at,verified,created_at) VALUES (?,?, 'lab_public_page','SC Labs',?,?,?,?,?,1,?)`).run(`coa-${crypto.randomUUID()}`,batchId,sample.sourceUrl,sample.sampleId,JSON.stringify(sample.raw),'sclabs-public-v2',now,now);
  return { productId: product.id, batchId, analyteCount: sample.analytes.length, sampleId: sample.sampleId };
}
