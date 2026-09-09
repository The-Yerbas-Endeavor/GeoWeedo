import crypto from 'crypto';
import { PDFParse } from 'pdf-parse';

export type ScLabsCoaPdfAnalyte = {
  groupName: string;
  analyteName: string;
  value: number | null;
  unit: string | null;
  lod?: number | null;
  loq?: number | null;
  status?: string | null;
  limitValue?: number | null;
  limitUnit?: string | null;
};

export type ScLabsCoaPdfData = {
  sha256: string;
  sampleId: string | null;
  productName: string | null;
  brandName: string | null;
  productType: string | null;
  netContents: string | null;
  batchNumber: string | null;
  uid: string | null;
  labName: string;
  labLicenseNumber: string | null;
  producerName: string | null;
  producerLicenseNumber: string | null;
  collectedAt: string | null;
  receivedAt: string | null;
  testedAt: string | null;
  overallStatus: string | null;
  analytes: ScLabsCoaPdfAnalyte[];
  extractedText: string;
};

function capture(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return null;
}

function numeric(value: string | undefined | null) {
  if (!value || /^(ND|N\/A|NT|<LOQ|<LOD)$/i.test(value.trim())) return null;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function esc(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function canonicalStatus(value: string | undefined | null) {
  if (!value) return null;
  if (/^pass(ed)?$/i.test(value)) return 'Pass';
  if (/^fail(ed)?$/i.test(value)) return 'Fail';
  return value.trim() || null;
}

function addUnique(out: ScLabsCoaPdfAnalyte[], row: ScLabsCoaPdfAnalyte) {
  const existing = out.find(item => item.groupName === row.groupName && item.analyteName.toLowerCase() === row.analyteName.toLowerCase());
  if (!existing) out.push(row);
}

function parseKnownRows(text: string, groupName: string, names: string[]) {
  const out: ScLabsCoaPdfAnalyte[] = [];
  for (const name of names) {
    const line = text.match(new RegExp(`(?:^|\\n)\\s*${esc(name)}\\s+([^\\n]{0,180})`, 'im'))?.[1] || '';
    if (!line) continue;
    const values = [...line.matchAll(/(?:ND|N\/A|NT|<LO[QD]|-?\d+(?:\.\d+)?)/gi)].map(m => m[0]);
    const unit = line.match(/(%|mg\/?g|mg\/?mL|µg\/?g|ug\/?g|ppm|ppb|CFU\/?g)/i)?.[1] || null;
    const status = canonicalStatus(line.match(/\b(Pass|Fail|Passed|Failed)\b/i)?.[1]);
    if (!values.length && !status) continue;
    addUnique(out, { groupName, analyteName: name, value: numeric(values[0]), unit, lod: values.length >= 2 ? numeric(values[1]) : null, loq: values.length >= 3 ? numeric(values[2]) : null, limitValue: values.length >= 4 ? numeric(values[3]) : null, limitUnit: values.length >= 4 ? unit : null, status });
  }
  return out;
}

function extractAnalytes(text: string) {
  const out: ScLabsCoaPdfAnalyte[] = [];
  const cannabinoids = ['THCA','THCVA','THCV','Delta-9 THC','THC','CBDA','CBDVA','CBDV','CBD','CBGA','CBG','CBCA','CBC','CBN'];
  const terpenes = ['Alpha-Bisabolol','Alpha-Humulene','Alpha-Pinene','Alpha-Terpinene','Beta-Caryophyllene','Beta-Myrcene','Beta-Pinene','Borneol','Camphene','Camphor','Caryophyllene Oxide','Cedrol','Citral','Citronellol','Eucalyptol','Fenchol','Fenchone','Gamma-Terpinene','Geraniol','Guaiol','Isoborneol','Limonene','Linalool','Menthol','Nerolidol','Ocimene','Pulegone','Sabinene','Sabinene Hydrate','Terpineol','Terpinolene','Valencene'];
  const pesticides = ['Abamectin','Acephate','Acequinocyl','Acetamiprid','Aldicarb','Azoxystrobin','Bifenazate','Bifenthrin','Boscalid','Carbaryl','Carbofuran','Chlorantraniliprole','Chlorphenapyr','Chlorpyrifos','Clofentezine','Clothianidin','Coumaphos','Cyantraniliprole','Cyfluthrin','Cyhalothrin','Cypermethrin','Daminozide','DDVP','Diazinon','Dimethoate','Dimethomorph','Dinotefuran','Etoxazole','Etridiazole','Fenhexamid','Fenpyroximate','Fipronil','Flonicamid','Fludioxonil','Hexythiazox','Imazalil','Imidacloprid','Iprodione','Malathion','Metalaxyl','Methiocarb','Methomyl','Methyl parathion','Mevinphos','Myclobutanil','Naled','Oxamyl','Paclobutrazol','Permethrin','Phenothrin','Phosmet','Piperonylbutoxide','Prallethrin','Propiconazole','Propoxur','Pyraclostrobin','Pyrethrins','Pyridaben','Spinetoram','Spinosad','Spiromesifen','Spirotetramat','Spiroxamine','Tebuconazole','Thiacloprid','Thiamethoxam','Trifloxystrobin'];
  const heavyMetals = ['Arsenic','Cadmium','Lead','Mercury'];
  const mycotoxins = ['Aflatoxin B1','Aflatoxin B2','Aflatoxin G1','Aflatoxin G2','Ochratoxin A'];
  const solvents = ['Acetone','Acetonitrile','Benzene','Butane','Chloroform','Dichloromethane','Ethanol','Ethyl acetate','Ethyl ether','Ethylene oxide','Heptane','Hexane','Isopropyl alcohol','Methanol','Pentane','Propane','Toluene','Trichloroethylene','Xylenes'];
  const microbial = ['Aspergillus flavus','Aspergillus fumigatus','Aspergillus niger','Aspergillus terreus','E. coli','Escherichia coli','Salmonella'];

  for (const row of parseKnownRows(text, 'cannabinoid', cannabinoids)) addUnique(out, row);
  for (const row of parseKnownRows(text, 'terpene', terpenes)) addUnique(out, row);
  for (const row of parseKnownRows(text, 'pesticide', pesticides)) addUnique(out, row);
  for (const row of parseKnownRows(text, 'heavy_metal', heavyMetals)) addUnique(out, row);
  for (const row of parseKnownRows(text, 'mycotoxin', mycotoxins)) addUnique(out, row);
  for (const row of parseKnownRows(text, 'residual_solvent', solvents)) addUnique(out, row);
  for (const row of parseKnownRows(text, 'microbial', microbial)) addUnique(out, row);

  const moisture = text.match(/Moisture(?:\s+Content)?[^\n]{0,80}?(ND|-?\d+(?:\.\d+)?)\s*(%)/i);
  if (moisture) addUnique(out, { groupName: 'moisture', analyteName: 'Moisture Content', value: numeric(moisture[1]), unit: moisture[2] || null, status: null });
  const waterActivity = text.match(/Water\s+Activity[^\n]{0,80}?(ND|-?\d+(?:\.\d+)?)/i);
  if (waterActivity) addUnique(out, { groupName: 'water_activity', analyteName: 'Water Activity', value: numeric(waterActivity[1]), unit: null, status: null });
  const foreignMaterial = canonicalStatus(text.match(/Foreign\s+Material[\s\S]{0,120}?\b(Pass|Fail|Passed|Failed)\b/i)?.[1]);
  if (foreignMaterial) addUnique(out, { groupName: 'foreign_material', analyteName: 'Foreign Material', value: null, unit: null, status: foreignMaterial });

  const safetyPanels: Array<[string,string,RegExp]> = [
    ['pesticide','Pesticides',/Pesticides?[\s\S]{0,160}?\b(Pass|Fail|Passed|Failed)\b/i],
    ['heavy_metal','Heavy Metals',/Heavy\s+Metals?[\s\S]{0,160}?\b(Pass|Fail|Passed|Failed)\b/i],
    ['microbial','Microbial',/Microbial[\s\S]{0,160}?\b(Pass|Fail|Passed|Failed)\b/i],
    ['mycotoxin','Mycotoxins',/Mycotoxins?[\s\S]{0,160}?\b(Pass|Fail|Passed|Failed)\b/i],
    ['residual_solvent','Residual Solvents',/Residual\s+(?:Solvents?|Processing Chemicals?)[\s\S]{0,160}?\b(Pass|Fail|Passed|Failed)\b/i],
  ];
  for (const [groupName, analyteName, pattern] of safetyPanels) {
    const status = canonicalStatus(text.match(pattern)?.[1]);
    if (status) addUnique(out, { groupName, analyteName, value: null, unit: null, status });
  }
  return out;
}

export async function parseScLabsCoaPdf(bytes: Uint8Array): Promise<ScLabsCoaPdfData> {
  if (bytes.byteLength < 5 || Buffer.from(bytes.slice(0, 5)).toString('ascii') !== '%PDF-') throw new Error('Uploaded file is not a PDF.');
  if (bytes.byteLength > 15 * 1024 * 1024) throw new Error('COA PDF exceeds the 15 MB limit.');
  const parser = new PDFParse({ data: bytes });
  let text = '';
  try { const result = await parser.getText(); text = result.text || ''; } finally { await parser.destroy(); }
  if (!/SC\s*Labs/i.test(text)) throw new Error('PDF does not appear to be an SC Labs certificate.');

  const producerName = capture(text, [/(?:Client|Producer|Distributor|Licensee|Business)\s*(?:Name)?\s*:?\s*([^\n]+)/i,/Submitted\s+By\s*:?\s*([^\n]+)/i]);
  return {
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    sampleId: capture(text, [/Sample\s*ID\s*[:#]?\s*([A-Z0-9-]+)/i]),
    productName: capture(text, [/Sample(?:\/Product)?\s*(?:Name)?\s*:?\s*([^\n]+)/i, /Product\s+Name\s*:?\s*([^\n]+)/i]),
    brandName: capture(text, [/Brand\s*(?:Name)?\s*:?\s*([^\n]+)/i]),
    productType: capture(text, [/(?:Matrix|Product\s+Type|Sample\s+Type)\s*:?\s*([^\n]+)/i]),
    netContents: capture(text, [/(?:Net\s+(?:Weight|Contents?)|Package\s+Size)\s*:?\s*([^\n]+)/i]),
    batchNumber: capture(text, [/(?:Batch|Lot)\s*(?:Number|No\.?|#)?\s*[:#]?\s*([A-Z0-9._-]+)/i]),
    uid: capture(text, [/(?:Package\s*)?UID\s*[:#]?\s*([A-Z0-9._-]+)/i]),
    labName: 'SC Labs',
    labLicenseNumber: capture(text, [/(?:Laboratory|Lab)\s+License\s*(?:Number|No\.?|#)?\s*:?\s*([A-Z0-9._-]+)/i, /License\s*(?:No\.?|#)\s*:?\s*(C8-[A-Z0-9-]+)/i]),
    producerName,
    producerLicenseNumber: capture(text, [/(?:Client|Producer|Distributor|Licensee|Business)\s+License\s*(?:Number|No\.?|#)?\s*:?\s*([A-Z0-9._-]+)/i, /License\s*(?:No\.?|#)?\s*:?\s*((?:C10|C11|CDPH|CCL|CUL|MCRSA|LIC)[A-Z0-9._-]+)/i]),
    collectedAt: capture(text, [/Date\s+Collected\s*:?\s*([^\n]+)/i, /Collected\s*:?\s*([^\n]+)/i]),
    receivedAt: capture(text, [/Date\s+Received\s*:?\s*([^\n]+)/i, /Received\s*:?\s*([^\n]+)/i]),
    testedAt: capture(text, [/Date\s+(?:Issued|Completed|Reported)\s*:?\s*([^\n]+)/i, /(?:Issued|Completed|Reported)\s*:?\s*([^\n]+)/i]),
    overallStatus: canonicalStatus(capture(text, [/(?:Overall|Batch|Compliance)\s+(?:Result|Status)\s*:?\s*(Pass|Fail|Passed|Failed)/i])),
    analytes: extractAnalytes(text),
    extractedText: text.slice(0, 200000),
  };
}
