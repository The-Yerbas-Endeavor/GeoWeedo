export const PRODUCT_NORMALIZER_VERSION = 1;

export type ProductStrainType = 'indica' | 'sativa' | 'hybrid' | null;

export type ProductCategoryDefinition = {
  id: string;
  slug: string;
  name: string;
  sort: number;
  aliases: readonly string[];
};

export const PRODUCT_CATEGORY_DEFINITIONS: readonly ProductCategoryDefinition[] = [
  { id: 'cat-flower', slug: 'flower', name: 'Flower', sort: 10, aliases: ['flower', 'bud', 'buds', 'cannabis flower'] },
  { id: 'cat-prerolls', slug: 'pre-rolls', name: 'Pre-Rolls', sort: 20, aliases: ['pre roll', 'pre rolls', 'pre-roll', 'pre-rolls', 'preroll', 'prerolls', 'joint', 'joints', 'infused pre roll', 'infused pre-roll'] },
  { id: 'cat-vapes', slug: 'vapes', name: 'Vapes', sort: 30, aliases: ['vape', 'vapes', 'vaporizer', 'vaporizer cartridge', 'cartridge', 'cartridges', 'cart', 'carts', 'disposable vape', 'disposable', 'pod', 'pods'] },
  { id: 'cat-concentrates', slug: 'concentrates', name: 'Concentrates', sort: 40, aliases: ['concentrate', 'concentrates', 'extract', 'extracts', 'resin', 'live resin', 'rosin', 'live rosin', 'wax', 'badder', 'budder', 'shatter', 'sauce', 'diamonds', 'hash', 'hashish'] },
  { id: 'cat-edibles', slug: 'edibles', name: 'Edibles', sort: 50, aliases: ['edible', 'edibles', 'gummy', 'gummies', 'chocolate', 'chocolates', 'candy', 'candies', 'baked good', 'baked goods'] },
  { id: 'cat-beverages', slug: 'beverages', name: 'Beverages', sort: 60, aliases: ['beverage', 'beverages', 'drink', 'drinks', 'shot', 'shots', 'drink mix', 'drink mixes', 'mixer', 'mixers', 'soda', 'tea'] },
  { id: 'cat-tinctures', slug: 'tinctures', name: 'Tinctures', sort: 70, aliases: ['tincture', 'tinctures', 'drops', 'oral drops'] },
  { id: 'cat-capsules', slug: 'capsules-tablets', name: 'Capsules & Tablets', sort: 80, aliases: ['capsule', 'capsules', 'tablet', 'tablets', 'pill', 'pills', 'softgel', 'softgels'] },
  { id: 'cat-topicals', slug: 'topicals', name: 'Topicals', sort: 90, aliases: ['topical', 'topicals', 'balm', 'balms', 'salve', 'salves', 'lotion', 'lotions', 'cream', 'creams', 'patch', 'patches'] },
  { id: 'cat-sublinguals', slug: 'sublinguals', name: 'Sublinguals', sort: 100, aliases: ['sublingual', 'sublinguals', 'strip', 'strips', 'lozenge', 'lozenges'] },
  { id: 'cat-cbd-hemp', slug: 'cbd-hemp', name: 'CBD / Hemp', sort: 105, aliases: ['cbd', 'hemp', 'cbd hemp', 'hemp cbd', 'cbd flower', 'hemp flower'] },
  { id: 'cat-seeds-clones', slug: 'seeds-clones', name: 'Seeds & Clones', sort: 110, aliases: ['seed', 'seeds', 'clone', 'clones', 'plant', 'plants'] },
  { id: 'cat-accessories', slug: 'accessories', name: 'Accessories', sort: 120, aliases: ['accessory', 'accessories', 'grinder', 'grinders', 'rolling paper', 'rolling papers', 'papers', 'battery', 'batteries', 'pipe', 'pipes'] },
  { id: 'cat-other', slug: 'other', name: 'Other / Uncategorized', sort: 999, aliases: ['other', 'uncategorized', 'unknown'] },
] as const;

export type ProductTaxonomyInput = {
  sourceCategory?: unknown;
  productType?: unknown;
  productName?: unknown;
  strainType?: unknown;
};

export type ProductTaxonomyNormalization = {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  canonicalProductType: string | null;
  strainType: ProductStrainType;
  sourceCategory: string | null;
  confidence: number;
  ruleId: string;
  normalizerVersion: number;
};

type SubtypeRule = {
  type: string;
  categoryId: string;
  aliases: readonly string[];
};

const SUBTYPE_RULES: readonly SubtypeRule[] = [
  { type: 'infused-pre-roll', categoryId: 'cat-prerolls', aliases: ['infused pre roll', 'infused preroll', 'infused joint'] },
  { type: 'pre-roll', categoryId: 'cat-prerolls', aliases: ['pre roll', 'preroll', 'joint'] },
  { type: 'disposable', categoryId: 'cat-vapes', aliases: ['disposable vape', 'disposable vaporizer', 'all in one vape'] },
  { type: 'cartridge', categoryId: 'cat-vapes', aliases: ['vape cartridge', 'vaporizer cartridge', 'cartridge', 'cart'] },
  { type: 'pod', categoryId: 'cat-vapes', aliases: ['vape pod', 'pod'] },
  { type: 'live-rosin', categoryId: 'cat-concentrates', aliases: ['live rosin'] },
  { type: 'rosin', categoryId: 'cat-concentrates', aliases: ['rosin'] },
  { type: 'live-resin', categoryId: 'cat-concentrates', aliases: ['live resin'] },
  { type: 'resin', categoryId: 'cat-concentrates', aliases: ['resin'] },
  { type: 'diamonds', categoryId: 'cat-concentrates', aliases: ['diamonds', 'diamond sauce'] },
  { type: 'badder', categoryId: 'cat-concentrates', aliases: ['badder', 'batter'] },
  { type: 'budder', categoryId: 'cat-concentrates', aliases: ['budder'] },
  { type: 'shatter', categoryId: 'cat-concentrates', aliases: ['shatter'] },
  { type: 'wax', categoryId: 'cat-concentrates', aliases: ['wax'] },
  { type: 'gummies', categoryId: 'cat-edibles', aliases: ['gummy', 'gummies'] },
  { type: 'chocolate', categoryId: 'cat-edibles', aliases: ['chocolate', 'chocolates'] },
  { type: 'baked-good', categoryId: 'cat-edibles', aliases: ['baked good', 'brownie', 'cookie'] },
  { type: 'beverage', categoryId: 'cat-beverages', aliases: ['beverage', 'drink', 'soda', 'tea', 'shot'] },
  { type: 'tincture', categoryId: 'cat-tinctures', aliases: ['tincture', 'oral drops', 'drops'] },
  { type: 'softgel', categoryId: 'cat-capsules', aliases: ['softgel', 'softgels'] },
  { type: 'capsule', categoryId: 'cat-capsules', aliases: ['capsule', 'capsules'] },
  { type: 'tablet', categoryId: 'cat-capsules', aliases: ['tablet', 'tablets', 'pill', 'pills'] },
  { type: 'topical', categoryId: 'cat-topicals', aliases: ['topical', 'balm', 'salve', 'lotion', 'cream'] },
  { type: 'patch', categoryId: 'cat-topicals', aliases: ['patch', 'patches'] },
  { type: 'sublingual', categoryId: 'cat-sublinguals', aliases: ['sublingual', 'strip', 'lozenge'] },
  { type: 'flower', categoryId: 'cat-flower', aliases: ['flower', 'bud'] },
] as const;

export function normalizeTaxonomyText(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanOriginal(value: unknown) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return text || null;
}

function categoryById(id: string) {
  return PRODUCT_CATEGORY_DEFINITIONS.find(category => category.id === id) || PRODUCT_CATEGORY_DEFINITIONS[PRODUCT_CATEGORY_DEFINITIONS.length - 1];
}

function allCategoryAliases() {
  const aliases: Array<{ category: ProductCategoryDefinition; alias: string }> = [];
  for (const category of PRODUCT_CATEGORY_DEFINITIONS) {
    for (const raw of [category.name, category.slug, ...category.aliases]) {
      const alias = normalizeTaxonomyText(raw);
      if (alias) aliases.push({ category, alias });
    }
  }
  return aliases.sort((a, b) => b.alias.length - a.alias.length || a.category.sort - b.category.sort);
}

const CATEGORY_ALIASES = allCategoryAliases();

function categoryMatch(value: unknown) {
  const normalized = normalizeTaxonomyText(value);
  if (!normalized || /^(indica|sativa|hybrid)$/.test(normalized)) return null;

  const exact = CATEGORY_ALIASES.find(entry => entry.alias === normalized);
  if (exact) return { category: exact.category, exact: true };

  const padded = ` ${normalized} `;
  const contained = CATEGORY_ALIASES.find(entry => {
    if (['other', 'uncategorized', 'unknown'].includes(entry.alias)) return false;
    return padded.includes(` ${entry.alias} `);
  });
  return contained ? { category: contained.category, exact: false } : null;
}

function subtypeMatch(value: unknown) {
  const normalized = normalizeTaxonomyText(value);
  if (!normalized) return null;
  const padded = ` ${normalized} `;
  for (const rule of SUBTYPE_RULES) {
    const aliases = [...rule.aliases].map(normalizeTaxonomyText).sort((a, b) => b.length - a.length);
    const alias = aliases.find(candidate => candidate === normalized || padded.includes(` ${candidate} `));
    if (alias) return rule;
  }
  return null;
}

function strainMatch(...values: unknown[]): ProductStrainType {
  for (const value of values) {
    const normalized = normalizeTaxonomyText(value);
    if (!normalized) continue;
    const tokens = new Set(normalized.split(' '));
    if (tokens.has('hybrid')) return 'hybrid';
    if (tokens.has('indica')) return 'indica';
    if (tokens.has('sativa')) return 'sativa';
  }
  return null;
}

export function normalizeProductTaxonomy(input: ProductTaxonomyInput): ProductTaxonomyNormalization {
  const sourceCategory = cleanOriginal(input.sourceCategory) || cleanOriginal(input.productType);
  const strainType = strainMatch(input.strainType, input.sourceCategory, input.productType, input.productName);

  const categoryCandidates: Array<{ field: string; value: unknown; exactConfidence: number; fuzzyConfidence: number }> = [
    { field: 'source-category', value: input.sourceCategory, exactConfidence: 0.99, fuzzyConfidence: 0.95 },
    { field: 'product-type', value: input.productType, exactConfidence: 0.98, fuzzyConfidence: 0.93 },
    { field: 'product-name', value: input.productName, exactConfidence: 0.84, fuzzyConfidence: 0.72 },
  ];

  let category: ProductCategoryDefinition | null = null;
  let confidence = 0.5;
  let ruleId = 'fallback:other';

  for (const candidate of categoryCandidates) {
    const match = categoryMatch(candidate.value);
    if (!match) continue;
    category = match.category;
    confidence = match.exact ? candidate.exactConfidence : candidate.fuzzyConfidence;
    ruleId = `${match.exact ? 'alias' : 'keyword'}:${candidate.field}:${category.slug}`;
    break;
  }

  let subtype = subtypeMatch(input.productType) || subtypeMatch(input.sourceCategory) || subtypeMatch(input.productName);
  if (!category && subtype) {
    category = categoryById(subtype.categoryId);
    confidence = 0.9;
    ruleId = `subtype:${subtype.type}`;
  }

  if (!category) category = categoryById('cat-other');
  if (subtype && subtype.categoryId !== category.id) subtype = null;

  return {
    categoryId: category.id,
    categorySlug: category.slug,
    categoryName: category.name,
    canonicalProductType: subtype?.type || null,
    strainType,
    sourceCategory,
    confidence,
    ruleId,
    normalizerVersion: PRODUCT_NORMALIZER_VERSION,
  };
}
