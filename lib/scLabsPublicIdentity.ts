import type { ScLabsNormalizedSample } from './scLabs';

function clean(value: unknown) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function sameText(left: unknown, right: unknown) {
  const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && a === b);
}

function comparable(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanScLabsProductName(value: string) {
  let text = clean(value) || '';
  if (!text) return value;

  // Public PhytoFacts headings can append a chemistry summary and "Powered By"
  // text to the product title. That data belongs in analytes, not the catalog name.
  text = text
    .replace(/\s*\(\s*C-\s*-?\d+(?:\.\d+)?%[\s\S]*$/i, '')
    .replace(/\s+Powered By\b[\s\S]*$/i, '')
    .trim();

  // Some PhytoFacts pages repeat the full product title twice before the stats.
  // Collapse only exact normalized duplicate halves so legitimate names are kept.
  const words = text.split(/\s+/).filter(Boolean);
  for (let split = Math.ceil(words.length / 2); split < words.length; split += 1) {
    const left = words.slice(0, split).join(' ');
    const right = words.slice(split).join(' ');
    if (right.split(/\s+/).length >= 3 && comparable(left) === comparable(right)) {
      text = left;
      break;
    }
  }

  return clean(text) || value;
}

function titleCaseSlug(value: string) {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.length <= 3 && /^[a-z]+$/i.test(part)
      ? part.toUpperCase()
      : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ')
    .replace(/\bLlc\b/g, 'LLC')
    .replace(/\bInc\b/g, 'Inc.');
}

function catalogBrand(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const slug = parts[0] || '';
    if (!slug || ['sample', 'samples', 'phytofacts', 'result', 'results'].includes(slug.toLowerCase())) return null;
    return clean(titleCaseSlug(slug));
  } catch {
    return null;
  }
}

function headingBrand(productName: string) {
  const heading = clean(productName);
  if (!heading || !heading.includes('|')) return null;
  const prefix = clean(heading.split('|')[0]);
  if (!prefix || prefix.length < 2 || prefix.length > 90) return null;
  return prefix;
}

export function inferScLabsConsumerBrand(sourceUrl: string, productName: string) {
  return headingBrand(productName) || catalogBrand(sourceUrl);
}

export function normalizeScLabsDate(value?: string | null) {
  const text = clean(value);
  if (!text) return null;
  const cleaned = text.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1');
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * SC Labs' public PhytoFacts page labels the license holder as "Business Name".
 * That value is not necessarily the consumer-facing brand. The legacy adapter
 * used it as a brand fallback, so normalize public records before ingestion:
 * keep the licensed business in producerName and infer the consumer brand from
 * explicit brand data, the product heading, or the public catalog slug.
 */
export function normalizeScLabsPublicSample(sample: ScLabsNormalizedSample): ScLabsNormalizedSample {
  const productName = cleanScLabsProductName(sample.productName);
  const currentBrand = clean(sample.brandName);
  const licensedBusiness = clean(sample.producerName) || currentBrand;
  const inferredBrand = inferScLabsConsumerBrand(sample.sourceUrl, productName);
  const brandName = currentBrand && licensedBusiness && !sameText(currentBrand, licensedBusiness)
    ? currentBrand
    : inferredBrand;

  return {
    ...sample,
    productName,
    brandName,
    producerName: licensedBusiness,
    collectedAt: normalizeScLabsDate(sample.collectedAt),
    receivedAt: normalizeScLabsDate(sample.receivedAt),
    testedAt: normalizeScLabsDate(sample.testedAt),
  };
}
