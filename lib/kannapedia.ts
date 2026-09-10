import crypto from 'crypto';
import { getDatabase } from './sqlite.ts';

type ChemistryRow = { groupName: 'cannabinoid' | 'terpene'; analyteName: string; value: number | null; unit: string | null };

export type KannapediaCultivar = {
  rspId: string;
  name: string;
  registrant: string | null;
  sampleName: string | null;
  accessionDate: string | null;
  reportedSex: string | null;
  reportType: string | null;
  dnaSource: string | null;
  plantType: string | null;
  rarity: string | null;
  rarityPercentile: number | null;
  heterozygosity: number | null;
  chemistry: ChemistryRow[];
  genetics: Record<string, string>;
  sourceUrl: string;
  rawText: string;
};

const CANNABINOIDS = ['THC + THCA','CBD + CBDA','THCV + THCVA','CBC + CBCA','CBG + CBGA','CBN + CBNA'];
const TERPENES = ['α-Bisabolol','Borneol','Camphene','Carene','Caryophyllene oxide','β-Caryophyllene','Fenchol','Geraniol','α-Humulene','Limonene','Linalool','Myrcene','α-Phellandrene','Terpinolene','α-Terpineol','α-Terpinene','γ-Terpinene','Total Nerolidol','Total Ocimene','α-Pinene','β-Pinene'];

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

function htmlText(html: string) {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h1|h2|h3|h4|dt|dd|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function clean(value: unknown) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizeName(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capture(text: string, label: string, nextLabels: string[]) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const next = nextLabels.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = text.match(new RegExp(`${escaped}\\s*\\n?\\s*([^\\n]{1,240}?)(?=\\n(?:${next})\\b|$)`, 'i'));
  return clean(match?.[1]);
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function parsePercent(text: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escaped}\\s*\\n?\\s*(-?\\d+(?:\\.\\d+)?)\\s*%`, 'i'));
  return match ? Number(match[1]) : null;
}

function chemistryRows(text: string) {
  const rows: ChemistryRow[] = [];
  for (const analyteName of CANNABINOIDS) {
    const value = parsePercent(text, analyteName);
    if (value !== null) rows.push({ groupName: 'cannabinoid', analyteName, value, unit: '%' });
  }
  for (const analyteName of TERPENES) {
    const value = parsePercent(text, analyteName);
    if (value !== null) rows.push({ groupName: 'terpene', analyteName, value, unit: '%' });
  }
  return rows;
}

function extractSection(html: string, heading: string) {
  const headingPattern = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<h[2-5][^>]*>[^<]*${headingPattern}[^<]*<\\/h[2-5]>([\\s\\S]*?)(?=<h[2-5][^>]*>|$)`, 'i'));
  if (!match) return null;
  return clean(htmlText(match[1]).slice(0, 3000));
}

function inferPlantType(text: string) {
  const match = text.match(/\bPlant Type\s*[:\n]?\s*(Type\s+[IVX]+|Type\s+\d+|[IVX]+)\b/i)
    || text.match(/\b(Type\s+[IVX]+)\b/i);
  return clean(match?.[1]);
}

export function parseKannapediaPage(html: string, sourceUrl: string): KannapediaCultivar {
  const text = htmlText(html);
  const rspMatch = sourceUrl.match(/\/strains\/rsp(\d+)/i) || text.match(/\bRSP\s*(\d+)\b/i);
  const rspId = rspMatch?.[1] || '';
  const name = clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ')) || '';
  if (!rspId || !name) throw new Error('Kannapedia page did not expose a cultivar name and RSP ID.');

  const labels = ['Sample Name','Accession Date','Reported Plant Sex','Report Type','DNA Extracted From','Heterozygosity','Chemical Information','Cannabinoids','Terpenoids','Rarity'];
  const registrant = clean(text.match(/\bRegistrant\s*:\s*([^\n]{1,180})/i)?.[1]);
  const sampleName = capture(text, 'Sample Name', labels);
  const accessionDate = parseDate(capture(text, 'Accession Date', labels));
  const reportedSex = capture(text, 'Reported Plant Sex', labels);
  const reportType = capture(text, 'Report Type', labels);
  const dnaSource = capture(text, 'DNA Extracted From', labels);
  const rarity = clean(text.match(/\bRarity\s*:\s*([^\n]{1,80})/i)?.[1]);
  const rarityPercentileMatch = text.match(/\((\d+(?:\.\d+)?)\s*(?:st|nd|rd|th)?\s*percentile\)/i);
  const heterozygosity = parsePercent(text, 'Heterozygosity');

  const genetics: Record<string, string> = {};
  for (const [key, heading] of [
    ['cannabinoidSynthase','Cannabinoid Synthase'],
    ['terpeneSynthase','Terpene Synthase'],
    ['diseaseResistance','Disease Resistance'],
    ['pathogenResistance','Pathogen Resistance'],
    ['flowering','Flowering'],
    ['microbiome','Microbiome'],
  ] as const) {
    const section = extractSection(html, heading);
    if (section) genetics[key] = section;
  }

  return {
    rspId,
    name,
    registrant,
    sampleName,
    accessionDate,
    reportedSex,
    reportType,
    dnaSource,
    plantType: inferPlantType(text),
    rarity,
    rarityPercentile: rarityPercentileMatch ? Number(rarityPercentileMatch[1]) : null,
    heterozygosity,
    chemistry: chemistryRows(text),
    genetics,
    sourceUrl,
    rawText: text,
  };
}

export function discoverKannapediaUrls(html: string) {
  const urls = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']*\/strains\/rsp\d+\/?)["']/gi)) {
    try { urls.add(new URL(match[1], 'https://kannapedia.net').toString()); } catch {}
  }
  return [...urls];
}

export function ensureCultivarSchema() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_cultivars (
      id TEXT PRIMARY KEY,
      rsp_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      registrant TEXT,
      sample_name TEXT,
      accession_date TEXT,
      reported_sex TEXT,
      report_type TEXT,
      dna_source TEXT,
      plant_type TEXT,
      rarity TEXT,
      rarity_percentile REAL,
      heterozygosity REAL,
      genetics_json TEXT,
      source_name TEXT NOT NULL DEFAULT 'Kannapedia',
      source_url TEXT NOT NULL,
      raw_text TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cannabis_cultivar_chemistry (
      id TEXT PRIMARY KEY,
      cultivar_id TEXT NOT NULL,
      group_name TEXT NOT NULL,
      analyte_name TEXT NOT NULL,
      value REAL,
      unit TEXT,
      reporting_basis TEXT NOT NULL DEFAULT 'registrant_reported',
      source_name TEXT NOT NULL DEFAULT 'Kannapedia',
      created_at TEXT NOT NULL,
      FOREIGN KEY(cultivar_id) REFERENCES cannabis_cultivars(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cannabis_cultivar_aliases (
      id TEXT PRIMARY KEY,
      cultivar_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(cultivar_id, normalized_alias),
      FOREIGN KEY(cultivar_id) REFERENCES cannabis_cultivars(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cannabis_product_cultivar_links (
      product_id TEXT NOT NULL,
      cultivar_id TEXT NOT NULL,
      match_method TEXT NOT NULL,
      confidence TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(product_id, cultivar_id),
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE CASCADE,
      FOREIGN KEY(cultivar_id) REFERENCES cannabis_cultivars(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS cannabis_cultivars_name_idx ON cannabis_cultivars(normalized_name);
    CREATE INDEX IF NOT EXISTS cannabis_cultivars_registrant_idx ON cannabis_cultivars(registrant);
    CREATE INDEX IF NOT EXISTS cannabis_cultivar_chemistry_idx ON cannabis_cultivar_chemistry(cultivar_id, group_name);
  `);
  return db;
}

function aliasesForCultivar(cultivar: KannapediaCultivar) {
  const aliases = new Set<string>([cultivar.name]);
  const withoutNumber = cultivar.name.replace(/\s*#\d+\s*$/i, '').trim();
  if (withoutNumber && withoutNumber !== cultivar.name) aliases.add(withoutNumber);
  return [...aliases];
}

export function ingestKannapediaCultivar(cultivar: KannapediaCultivar) {
  const db = ensureCultivarSchema();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id, first_seen_at FROM cannabis_cultivars WHERE rsp_id=?').get(cultivar.rspId) as any;
  const id = existing?.id || `cc-${crypto.randomUUID()}`;
  const normalized = normalizeName(cultivar.name);

  if (existing) {
    db.prepare(`
      UPDATE cannabis_cultivars SET
        name=?, normalized_name=?, registrant=?, sample_name=?, accession_date=?, reported_sex=?, report_type=?, dna_source=?,
        plant_type=?, rarity=?, rarity_percentile=?, heterozygosity=?, genetics_json=?, source_url=?, raw_text=?, last_seen_at=?, updated_at=?
      WHERE id=?
    `).run(cultivar.name, normalized, cultivar.registrant, cultivar.sampleName, cultivar.accessionDate, cultivar.reportedSex,
      cultivar.reportType, cultivar.dnaSource, cultivar.plantType, cultivar.rarity, cultivar.rarityPercentile, cultivar.heterozygosity,
      JSON.stringify(cultivar.genetics || {}), cultivar.sourceUrl, cultivar.rawText, now, now, id);
    db.prepare('DELETE FROM cannabis_cultivar_chemistry WHERE cultivar_id=?').run(id);
    db.prepare('DELETE FROM cannabis_cultivar_aliases WHERE cultivar_id=?').run(id);
  } else {
    db.prepare(`
      INSERT INTO cannabis_cultivars
        (id,rsp_id,name,normalized_name,registrant,sample_name,accession_date,reported_sex,report_type,dna_source,plant_type,rarity,rarity_percentile,heterozygosity,genetics_json,source_name,source_url,raw_text,first_seen_at,last_seen_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Kannapedia',?,?,?,?,?,?)
    `).run(id, cultivar.rspId, cultivar.name, normalized, cultivar.registrant, cultivar.sampleName, cultivar.accessionDate,
      cultivar.reportedSex, cultivar.reportType, cultivar.dnaSource, cultivar.plantType, cultivar.rarity, cultivar.rarityPercentile,
      cultivar.heterozygosity, JSON.stringify(cultivar.genetics || {}), cultivar.sourceUrl, cultivar.rawText, now, now, now, now);
  }

  const addChem = db.prepare(`
    INSERT INTO cannabis_cultivar_chemistry
      (id,cultivar_id,group_name,analyte_name,value,unit,reporting_basis,source_name,created_at)
    VALUES (?,?,?,?,?,?,'registrant_reported','Kannapedia',?)
  `);
  for (const row of cultivar.chemistry) addChem.run(`ccc-${crypto.randomUUID()}`, id, row.groupName, row.analyteName, row.value, row.unit, now);

  const addAlias = db.prepare(`
    INSERT OR IGNORE INTO cannabis_cultivar_aliases
      (id,cultivar_id,alias,normalized_alias,source,created_at)
    VALUES (?,?,?,?,?,?)
  `);
  for (const alias of aliasesForCultivar(cultivar)) {
    const normalizedAlias = normalizeName(alias);
    if (normalizedAlias) addAlias.run(`cca-${crypto.randomUUID()}`, id, alias, normalizedAlias, 'Kannapedia', now);
  }

  return { id, created: !existing, chemistryCount: cultivar.chemistry.length };
}

function productCandidateName(productName: string, brandName?: string | null) {
  let value = productName;
  if (brandName) value = value.replace(new RegExp(`^${brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[|:\-–—]*\\s*`, 'i'), '');
  value = value
    .replace(/\b(?:live|cured)?\s*(?:resin|rosin)?\s*(?:juice\s*)?(?:cart(?:ridge)?|aio|vape)\b.*$/i, '')
    .replace(/\b\d+(?:\.\d+)?\s*g\b.*$/i, '')
    .replace(/[|:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeName(value);
}

export function rebuildProductCultivarLinks() {
  const db = ensureCultivarSchema();
  const now = new Date().toISOString();
  db.prepare('DELETE FROM cannabis_product_cultivar_links').run();
  const products = db.prepare('SELECT id, brand_name, product_name FROM cannabis_products').all() as any[];
  const aliases = db.prepare(`
    SELECT a.cultivar_id, a.normalized_alias, c.name
    FROM cannabis_cultivar_aliases a JOIN cannabis_cultivars c ON c.id=a.cultivar_id
    WHERE length(a.normalized_alias) >= 4
  `).all() as any[];
  const insert = db.prepare(`
    INSERT OR IGNORE INTO cannabis_product_cultivar_links
      (product_id,cultivar_id,match_method,confidence,created_at)
    VALUES (?,?,?,'high',?)
  `);
  let links = 0;
  for (const product of products) {
    const candidate = productCandidateName(product.product_name, product.brand_name);
    if (!candidate) continue;
    const exact = aliases.filter(row => row.normalized_alias === candidate);
    if (exact.length !== 1) continue;
    insert.run(product.id, exact[0].cultivar_id, 'normalized_exact_alias', now);
    links += 1;
  }
  return links;
}

export function getCultivarCatalog(options: { q?: string | null; page?: number; pageSize?: number } = {}) {
  const db = ensureCultivarSchema();
  const q = normalizeName(options.q || '');
  const pageSize = Math.max(10, Math.min(100, Number(options.pageSize || 50)));
  const page = Math.max(1, Number(options.page || 1));
  const where = q ? `WHERE normalized_name LIKE ? OR lower(registrant) LIKE ? OR rsp_id LIKE ?` : '';
  const args = q ? [`%${q}%`, `%${String(options.q || '').toLowerCase()}%`, `%${String(options.q || '')}%`] : [];
  const count = db.prepare(`SELECT COUNT(*) AS count FROM cannabis_cultivars ${where}`).get(...args) as any;
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM cannabis_cultivar_chemistry x WHERE x.cultivar_id=c.id) AS chemistry_count
    FROM cannabis_cultivars c
    ${where}
    ORDER BY COALESCE(accession_date, created_at) DESC, name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).all(...args, pageSize, (page - 1) * pageSize) as any[];
  const total = Number(count?.count || 0);
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export function getCultivarByRsp(rspId: string) {
  const db = ensureCultivarSchema();
  const cultivar = db.prepare('SELECT * FROM cannabis_cultivars WHERE rsp_id=? LIMIT 1').get(String(rspId).replace(/^rsp/i, '')) as any;
  if (!cultivar) return null;
  const chemistry = db.prepare(`SELECT group_name,analyte_name,value,unit,reporting_basis FROM cannabis_cultivar_chemistry WHERE cultivar_id=? ORDER BY group_name,analyte_name`).all(cultivar.id) as any[];
  let genetics: Record<string, string> = {};
  try { genetics = cultivar.genetics_json ? JSON.parse(cultivar.genetics_json) : {}; } catch {}
  return { ...cultivar, chemistry, genetics };
}

export function getCultivarLinksForProduct(productId: string) {
  const db = ensureCultivarSchema();
  return db.prepare(`
    SELECT c.rsp_id,c.name,c.registrant,l.match_method,l.confidence
    FROM cannabis_product_cultivar_links l
    JOIN cannabis_cultivars c ON c.id=l.cultivar_id
    WHERE l.product_id=?
    ORDER BY c.name COLLATE NOCASE
  `).all(productId) as any[];
}
