import assert from 'node:assert/strict';
import { normalizeProductTaxonomy } from '../lib/productTaxonomy.ts';

const cases = [
  [{ productType: 'bud' }, { categorySlug: 'flower' }],
  [{ productType: 'Pre Roll' }, { categorySlug: 'pre-rolls', canonicalProductType: 'pre-roll' }],
  [{ productType: 'Vape Cartridge' }, { categorySlug: 'vapes', canonicalProductType: 'cartridge' }],
  [{ productType: 'THC Gummies' }, { categorySlug: 'edibles', canonicalProductType: 'gummies' }],
  [{ productType: 'Live Resin' }, { categorySlug: 'concentrates', canonicalProductType: 'live-resin' }],
  [{ productType: 'CBD Flower' }, { categorySlug: 'cbd-hemp' }],
  [{ productType: 'Rolling Papers' }, { categorySlug: 'accessories' }],
  [{ productType: 'Indica' }, { categorySlug: 'other', strainType: 'indica' }],
  [{ productType: 'Hybrid Gummies' }, { categorySlug: 'edibles', canonicalProductType: 'gummies', strainType: 'hybrid' }],
  [{ sourceCategory: 'Mystery Product Type', productName: 'Example Item' }, { categorySlug: 'other', sourceCategory: 'Mystery Product Type' }],
];

for (const [input, expected] of cases) {
  const actual = normalizeProductTaxonomy(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value, `${JSON.stringify(input)} expected ${key}=${value}, got ${actual[key]}`);
  }
}

console.log(`Product taxonomy tests passed: ${cases.length}`);
