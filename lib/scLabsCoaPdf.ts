import crypto from 'crypto';
import { PDFParse } from 'pdf-parse';

export type ScLabsCoaPdfData = {
  sha256: string;
  sampleId: string | null;
  productName: string | null;
  batchNumber: string | null;
  uid: string | null;
  collectedAt: string | null;
  receivedAt: string | null;
  testedAt: string | null;
  overallStatus: string | null;
  analytes: Array<{
    groupName: string;
    analyteName: string;
    value: number | null;
    unit: string | null;
    status?: string | null;
  }>;
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

function numeric(value: string | undefined) {
  if (!value || /^(ND|N\/A)$/i.test(value.trim())) return null;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function extractAnalytes(text: string) {
  const out: ScLabsCoaPdfData['analytes'] = [];
  const cannabinoids = ['THCA','THCVA','THCV','THC','CBDA','CBDVA','CBDV','CBD','CBGA','CBG','CBCA','CBC','CBN'];

  for (const name of cannabinoids) {
    const match = text.match(new RegExp(`(?:^|\\n)\\s*${name}\\s+(ND|-?\\d+(?:\\.\\d+)?)\\s*(%|mg\\/?g|mg\\/?mL)?`, 'im'));
    if (!match) continue;
    out.push({ groupName: 'cannabinoid', analyteName: name, value: numeric(match[1]), unit: match[2] || null });
  }

  const safetyPanels: Array<[string,string,RegExp]> = [
    ['pesticide','Pesticides',/Pesticides?[\s\S]{0,120}?\b(Pass|Fail|Passed|Failed)\b/i],
    ['heavy_metal','Heavy Metals',/Heavy\s+Metals?[\s\S]{0,120}?\b(Pass|Fail|Passed|Failed)\b/i],
    ['microbial','Microbial',/Microbial[\s\S]{0,120}?\b(Pass|Fail|Passed|Failed)\b/i],
    ['mycotoxin','Mycotoxins',/Mycotoxins?[\s\S]{0,120}?\b(Pass|Fail|Passed|Failed)\b/i],
    ['residual_solvent','Residual Solvents',/Residual\s+(?:Solvents?|Processing Chemicals?)[\s\S]{0,120}?\b(Pass|Fail|Passed|Failed)\b/i],
  ];

  for (const [groupName, analyteName, pattern] of safetyPanels) {
    const status = text.match(pattern)?.[1];
    if (status) out.push({ groupName, analyteName, value: null, unit: null, status: /^pass/i.test(status) ? 'Pass' : 'Fail' });
  }

  return out;
}

export async function parseScLabsCoaPdf(bytes: Uint8Array): Promise<ScLabsCoaPdfData> {
  if (bytes.byteLength < 5 || Buffer.from(bytes.slice(0, 5)).toString('ascii') !== '%PDF-') {
    throw new Error('Uploaded file is not a PDF.');
  }
  if (bytes.byteLength > 15 * 1024 * 1024) throw new Error('COA PDF exceeds the 15 MB limit.');

  const parser = new PDFParse({ data: bytes });
  let text = '';
  try {
    const result = await parser.getText();
    text = result.text || '';
  } finally {
    await parser.destroy();
  }

  if (!/SC\s*Labs/i.test(text)) throw new Error('PDF does not appear to be an SC Labs certificate.');

  return {
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    sampleId: capture(text, [/Sample\s*ID\s*[:#]?\s*([A-Z0-9-]+)/i]),
    productName: capture(text, [/Sample(?:\/Product)?\s*(?:Name)?\s*:?\s*([^\n]+)/i, /Product\s+Name\s*:?\s*([^\n]+)/i]),
    batchNumber: capture(text, [/(?:Batch|Lot)\s*(?:Number|No\.?|#)?\s*[:#]?\s*([A-Z0-9._-]+)/i]),
    uid: capture(text, [/(?:Package\s*)?UID\s*[:#]?\s*([A-Z0-9._-]+)/i]),
    collectedAt: capture(text, [/Date\s+Collected\s*:?\s*([^\n]+)/i]),
    receivedAt: capture(text, [/Date\s+Received\s*:?\s*([^\n]+)/i]),
    testedAt: capture(text, [/Date\s+(?:Issued|Completed)\s*:?\s*([^\n]+)/i]),
    overallStatus: capture(text, [/(?:Overall|Batch)\s+(?:Result|Status)\s*:?\s*(Pass|Fail|Passed|Failed)/i]),
    analytes: extractAnalytes(text),
    extractedText: text.slice(0, 200000),
  };
}
