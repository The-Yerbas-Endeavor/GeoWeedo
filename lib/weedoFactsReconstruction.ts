import 'server-only';

import { getDatabase } from '@/lib/sqlite';
import { configuredSiteSearchProvider, searchOfficialSiteCandidates, type SiteSearchResult } from '@/lib/siteSearchProvider';

export type ReconstructionConfidence = 'strong_product_match' | 'possible_product_match' | 'no_confident_match';

export type ReconstructionEvidence = {
  upc: string;
  productName: string | null;
  batchNumber: string | null;
  uid: string | null;
  manufacturer: string | null;
  phone: string | null;
  thcPercent: number | null;
  thcMg: number | null;
  cbdPercent: number | null;
  cbdMg: number | null;
  productType: string | null;
  cultivarType: string | null;
};

export type ReconstructionCandidate = {
  url: string;
  title: string;
  snippet: string;
  sourceHost: string;
  score: number;
  confidence: 'strong' | 'possible' | 'weak';
  reasons: string[];
  queries: string[];
};

export type WeedoProductReconstruction = {
  upc: string;
  confidence: ReconstructionConfidence;
  score: number;
  evidence: ReconstructionEvidence;
  bestMatch: ReconstructionCandidate | null;
  candidates: ReconstructionCandidate[];
  provider: string | null;
  queries: string[];
  cached: boolean;
  searchedAt: string;
  notice: string;
};

function normalize(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compact(value: unknown) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function digits(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

function meaningfulTokens(value: unknown) {
  return normalize(value)
    .split(/\s+/)
    .filter(token => token.length >= 3 || token === 'og');
}

function tokenOverlap(needle: unknown, haystack: unknown) {
  const left = meaningfulTokens(needle);
  if (!left.length) return 0;
  const right = meaningfulTokens(haystack);
  let matched = 0;

  for (const token of left) {
    const hit = right.some(candidate => {
      if (candidate === token) return true;
      const shortest = Math.min(candidate.length, token.length);
      return shortest >= 4 && (candidate.startsWith(token) || token.startsWith(candidate));
    });
    if (hit) matched += 1;
  }

  return matched / left.length;
}

function host(raw: string) {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function numberMatch(text: string, patterns: RegExp[]) {
  const value = firstMatch(text, patterns);
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanManufacturer(line: string | null) {
  if (!line) return null;
  const withoutLabel = line.replace(/\b(?:mfg|pkg|manufacturer|manufactured by)\b\s*[:/#-]*/gi, '').trim();
  const corporate = withoutLabel.match(/^(.+?\b(?:llc|inc\.?|corp\.?|corporation|company|co\.?))\b/i)?.[1];
  if (corporate) return corporate.replace(/[|,:;]+$/g, '').trim() || null;
  return withoutLabel
    .replace(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}.*/g, '')
    .replace(/[|,:;]+$/g, '')
    .trim() || null;
}

function inferProductType(text: string) {
  const normalized = normalize(text);
  const checks: Array<[RegExp, string]> = [
    [/\b(?:cartridge|vape cart|vape cartridge|510 cart|cart)\b/, 'cartridge'],
    [/\b(?:pre roll|preroll|pre-roll)\b/, 'pre-roll'],
    [/\bflower\b/, 'flower'],
    [/\b(?:concentrate|wax|shatter|live resin|cured resin|rosin)\b/, 'concentrate'],
    [/\b(?:edible|gummy|gummies|chocolate)\b/, 'edible'],
    [/\btincture\b/, 'tincture'],
  ];
  return checks.find(([pattern]) => pattern.test(normalized))?.[1] || null;
}

function inferCultivarType(text: string) {
  const match = normalize(text).match(/\b(indica|sativa|hybrid)\b/);
  return match?.[1] || null;
}

export function parseReconstructionLabel(upc: string, labelText: string): ReconstructionEvidence {
  const text = String(labelText || '').replace(/\r/g, '\n');
  const lines = text.split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);

  // Avoid treating a short OCR fragment as an exact batch identifier. A false
  // exact match is worse than leaving the field blank and using the other evidence.
  const batchNumber = firstMatch(text, [
    /\bbatch\s*(?:#|no\.?|number)?\s*[:#-]?\s*([a-z0-9][a-z0-9-]{5,})/i,
    /\blot\s*(?:#|no\.?|number)?\s*[:#-]?\s*([a-z0-9][a-z0-9-]{5,})/i,
  ]);

  // Package UIDs are long identifiers. Reject short/truncated OCR fragments so
  // they cannot be scored later as an exact UID match.
  const uid = firstMatch(text, [
    /\buid\s*[:#.-]?\s*([a-z0-9]{20,})/i,
    /\bpackage\s*uid\s*[:#.-]?\s*([a-z0-9]{20,})/i,
  ]);

  const phone = firstMatch(text, [/(\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})/]);

  const manufacturerLine = lines.find(line => /\b(?:llc|inc\.?|corp\.?|corporation|company|co\.?)\b/i.test(line) && !/^total\b/i.test(line)) || null;
  const manufacturer = cleanManufacturer(manufacturerLine);

  const thcPercent = numberMatch(text, [
    /(?:total\s*)?thc\s*[:=]?\s*[<≤]?\s*(\d+(?:\.\d+)?)\s*%/i,
    /(\d+(?:\.\d+)?)\s*%\s*(?:total\s*)?thc\b/i,
  ]);
  const thcMg = numberMatch(text, [
    /(?:total\s*)?thc[^\n\r]{0,24}?(\d+(?:\.\d+)?)\s*mg\b/i,
    /(\d+(?:\.\d+)?)\s*mg[^\n\r]{0,18}?(?:total\s*)?thc\b/i,
  ]);
  const cbdPercent = numberMatch(text, [
    /(?:total\s*)?cb[do]\s*[:=]?\s*[<≤]?\s*(\d+(?:\.\d+)?)\s*%/i,
    /(\d+(?:\.\d+)?)\s*%\s*(?:total\s*)?cb[do]\b/i,
  ]);
  const cbdMg = numberMatch(text, [
    /(?:total\s*)?cb[do][^\n\r]{0,24}?(\d+(?:\.\d+)?)\s*mg\b/i,
    /(\d+(?:\.\d+)?)\s*mg[^\n\r]{0,18}?(?:total\s*)?cb[do]\b/i,
  ]);

  const ignoredProductLine = /^(?:mfg|pkg|batch|lot|uid|total|sum|thc|cbd|cbo|cannabinoids?|terpenes?|indica|sativa|hybrid|warning|government|license|lic\b|net wt|net weight)/i;
  const productName = lines.find(line => {
    if (line.length < 4 || line.length > 80 || ignoredProductLine.test(line)) return false;
    if (!/[a-z]/i.test(line)) return false;
    if (/\b(?:llc|inc\.?|corp\.?|corporation)\b/i.test(line)) return false;
    if (/\d{3}[\s.-]*\d{3}[\s.-]*\d{4}/.test(line)) return false;
    const letters = (line.match(/[a-z]/gi) || []).length;
    return letters >= 4;
  }) || null;

  return {
    upc: digits(upc),
    productName,
    batchNumber,
    uid,
    manufacturer,
    phone,
    thcPercent,
    thcMg,
    cbdPercent,
    cbdMg,
    productType: inferProductType(text),
    cultivarType: inferCultivarType(text),
  };
}

function relaxedProductTerms(productName: string | null) {
  if (!productName) return null;
  const terms = meaningfulTokens(productName).slice(0, 5);
  return terms.length ? terms.join(' ') : null;
}

function buildQueries(evidence: ReconstructionEvidence) {
  const queries: string[] = [];
  const add = (query: string | null) => {
    const trimmed = String(query || '').trim();
    if (trimmed && !queries.includes(trimmed)) queries.push(trimmed);
  };

  const relaxedProduct = relaxedProductTerms(evidence.productName);

  add(`\"${evidence.upc}\"`);
  if (evidence.batchNumber) add(`\"${evidence.batchNumber}\" cannabis`);
  if (evidence.uid) add(`\"${evidence.uid}\" cannabis`);
  if (relaxedProduct && evidence.manufacturer) add(`${relaxedProduct} \"${evidence.manufacturer}\" cannabis`);
  if (relaxedProduct && evidence.thcPercent !== null) add(`${relaxedProduct} \"${evidence.thcPercent}%\" cannabis`);
  if (relaxedProduct && evidence.productType) add(`${relaxedProduct} ${evidence.productType} cannabis`);
  if (evidence.phone) add(`\"${evidence.phone}\" cannabis`);
  if (relaxedProduct) add(`${relaxedProduct} cannabis`);
  if (evidence.manufacturer) add(`\"${evidence.manufacturer}\" cannabis`);
  return queries.slice(0, 7);
}

function extractThcPercent(text: string) {
  const patterns = [
    /(?:total\s*)?thc[^0-9]{0,18}(\d+(?:\.\d+)?)\s*%/i,
    /(\d+(?:\.\d+)?)\s*%[^a-z0-9]{0,10}(?:total\s*)?thc\b/i,
  ];
  return numberMatch(text, patterns);
}

function scoreSearchResult(evidence: ReconstructionEvidence, result: SiteSearchResult, queries: string[]): ReconstructionCandidate {
  const haystack = `${result.title} ${result.snippet} ${result.link}`;
  const normalizedHaystack = normalize(haystack);
  const compactHaystack = compact(haystack);
  const reasons: string[] = [];
  let score = 0;

  if (evidence.upc && compactHaystack.includes(evidence.upc)) {
    score += 50;
    reasons.push('exact UPC appears in the public result');
  }
  if (evidence.batchNumber && compactHaystack.includes(compact(evidence.batchNumber))) {
    score += 45;
    reasons.push('exact batch / lot appears in the public result');
  }
  if (evidence.uid && compactHaystack.includes(compact(evidence.uid))) {
    score += 45;
    reasons.push('exact package UID appears in the public result');
  }

  const productOverlap = tokenOverlap(evidence.productName, haystack);
  if (productOverlap >= 0.85) {
    score += 35;
    reasons.push('product name is a very strong match');
  } else if (productOverlap >= 0.5) {
    score += 22;
    reasons.push('product name is a partial match');
  }

  const manufacturerOverlap = tokenOverlap(evidence.manufacturer, haystack);
  if (manufacturerOverlap >= 0.8) {
    score += 25;
    reasons.push('manufacturer is a strong match');
  } else if (manufacturerOverlap >= 0.5) {
    score += 12;
    reasons.push('manufacturer is a partial match');
  }

  if (evidence.phone && digits(haystack).includes(digits(evidence.phone))) {
    score += 20;
    reasons.push('manufacturer phone number matches');
  }

  const resultThc = extractThcPercent(haystack);
  if (evidence.thcPercent !== null && resultThc !== null) {
    const delta = Math.abs(evidence.thcPercent - resultThc);
    if (delta <= 0.25) {
      score += 20;
      reasons.push('THC potency is an exact/near-exact match');
    } else if (delta <= 1) {
      score += 10;
      reasons.push('THC potency is a close match');
    }
  }

  if (evidence.productType && normalizedHaystack.includes(normalize(evidence.productType))) {
    score += 10;
    reasons.push('product form matches');
  }
  if (evidence.cultivarType && normalizedHaystack.includes(evidence.cultivarType)) {
    score += 5;
    reasons.push('label category matches');
  }

  score = Math.max(0, Math.min(100, score));
  const confidence: ReconstructionCandidate['confidence'] = score >= 60 && reasons.length >= 2 ? 'strong' : score >= 35 ? 'possible' : 'weak';
  return {
    url: result.link,
    title: result.title,
    snippet: result.snippet,
    sourceHost: host(result.link),
    score,
    confidence,
    reasons,
    queries,
  };
}

function ensureStorage() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS weedo_facts_reconstruction_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upc TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      confidence TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_weedo_facts_reconstruction_upc_created
      ON weedo_facts_reconstruction_runs(upc, created_at DESC);
  `);
  return db;
}

export function getCachedWeedoProductReconstruction(upc: string): WeedoProductReconstruction | null {
  const normalizedUpc = digits(upc);
  if (!/^\d{8,14}$/.test(normalizedUpc)) return null;
  const db = ensureStorage();
  const row = db.prepare(`
    SELECT result_json
    FROM weedo_facts_reconstruction_runs
    WHERE upc = ? AND confidence = 'strong_product_match'
    ORDER BY id DESC
    LIMIT 1
  `).get(normalizedUpc) as { result_json?: string } | undefined;
  if (!row?.result_json) return null;
  try {
    const parsed = JSON.parse(row.result_json) as WeedoProductReconstruction;
    return { ...parsed, cached: true };
  } catch {
    return null;
  }
}

export async function reconstructWeedoProduct(upc: string, labelText: string): Promise<WeedoProductReconstruction> {
  const normalizedUpc = digits(upc);
  if (!/^\d{8,14}$/.test(normalizedUpc)) throw new Error('A valid UPC/EAN barcode is required.');
  const text = String(labelText || '').trim();
  if (text.length < 8) throw new Error('Not enough label text was recognized to reconstruct this product.');

  const evidence = parseReconstructionLabel(normalizedUpc, text);
  const queries = buildQueries(evidence);
  const provider = configuredSiteSearchProvider();
  if (!provider) {
    throw new Error('Public product reconstruction is not configured. Set SEARXNG_URL for the self-hosted search service.');
  }

  const resultMap = new Map<string, { result: SiteSearchResult; queries: string[] }>();
  for (const query of queries) {
    try {
      const search = await searchOfficialSiteCandidates(query);
      for (const result of search.results) {
        const key = result.link.trim();
        if (!key) continue;
        const existing = resultMap.get(key);
        if (existing) {
          if (!existing.queries.includes(query)) existing.queries.push(query);
        } else {
          resultMap.set(key, { result, queries: [query] });
        }
      }
    } catch {
      // One failed search should not discard evidence from the remaining queries.
    }
  }

  const candidates = [...resultMap.values()]
    .map(item => scoreSearchResult(evidence, item.result, item.queries))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const bestMatch = candidates[0] || null;
  const score = bestMatch?.score || 0;
  let confidence: ReconstructionConfidence = 'no_confident_match';
  if (bestMatch?.confidence === 'strong') confidence = 'strong_product_match';
  else if (bestMatch?.confidence === 'possible') confidence = 'possible_product_match';

  const reconstruction: WeedoProductReconstruction = {
    upc: normalizedUpc,
    confidence,
    score,
    evidence,
    bestMatch,
    candidates,
    provider,
    queries,
    cached: false,
    searchedAt: new Date().toISOString(),
    notice: 'This is a public-source product reconstruction, not laboratory verification of the exact batch.',
  };

  const db = ensureStorage();
  db.prepare(`
    INSERT INTO weedo_facts_reconstruction_runs(upc, evidence_json, result_json, confidence, created_at)
    VALUES(?,?,?,?,?)
  `).run(normalizedUpc, JSON.stringify(evidence), JSON.stringify(reconstruction), confidence, reconstruction.searchedAt);

  return reconstruction;
}
