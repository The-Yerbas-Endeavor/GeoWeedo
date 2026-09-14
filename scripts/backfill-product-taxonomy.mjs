import { getDatabase } from '../lib/sqlite.ts';
import { ensureWeedoFactsSchema } from '../lib/weedoFacts.ts';
import { ensureProductCategorySchema } from '../lib/productCategories.ts';
import { ensureProductIdentitySchema, normalizeProductIdentifier } from '../lib/productIdentity.ts';
import { PRODUCT_NORMALIZER_VERSION, normalizeProductTaxonomy } from '../lib/productTaxonomy.ts';

const apply = process.argv.includes('--apply');

ensureWeedoFactsSchema();
const db = getDatabase();
ensureProductIdentitySchema(db);
ensureProductCategorySchema(db, { backfill: false });

const products = db.prepare(`
  SELECT id,product_name,product_type,source_category,category_id,category_source,
         canonical_product_type,strain_type,normalizer_version
  FROM cannabis_products
  ORDER BY product_name COLLATE NOCASE
`).all();

const report = {
  mode: apply ? 'apply' : 'dry-run',
  normalizerVersion: PRODUCT_NORMALIZER_VERSION,
  totalProducts: products.length,
  alreadyNormalized: 0,
  categoryAssignments: 0,
  existingCategoryMismatches: 0,
  subtypeDetected: 0,
  strainDetected: 0,
  otherOrUnmapped: 0,
  identifiers: 0,
  identifierCollisions: 0,
};

const normalizedRows = [];
const unresolved = new Map();
for (const row of products) {
  const normalized = normalizeProductTaxonomy({
    sourceCategory: row.source_category || row.product_type,
    productType: row.product_type,
    productName: row.product_name,
    strainType: row.strain_type,
  });
  normalizedRows.push({ row, normalized });

  if (Number(row.normalizer_version || 0) === PRODUCT_NORMALIZER_VERSION) report.alreadyNormalized += 1;
  if (!row.category_id) report.categoryAssignments += 1;
  if (row.category_id && row.category_id !== normalized.categoryId) report.existingCategoryMismatches += 1;
  if (normalized.canonicalProductType) report.subtypeDetected += 1;
  if (normalized.strainType) report.strainDetected += 1;
  if (normalized.categoryId === 'cat-other') {
    report.otherOrUnmapped += 1;
    const raw = normalized.sourceCategory || row.product_type || '(blank)';
    unresolved.set(raw, (unresolved.get(raw) || 0) + 1);
  }
}

const identifiers = db.prepare(`
  SELECT id,product_id,identifier_type,identifier_value,normalized_value,created_at,verified
  FROM cannabis_product_identifiers
`).all();
report.identifiers = identifiers.length;

const collisionMap = new Map();
for (const identifier of identifiers) {
  const normalizedValue = normalizeProductIdentifier(identifier.identifier_type, identifier.identifier_value);
  if (!normalizedValue) continue;
  const key = `${String(identifier.identifier_type || '').toLowerCase()}:${normalizedValue}`;
  const entries = collisionMap.get(key) || [];
  entries.push({ id: identifier.id, productId: identifier.product_id, value: identifier.identifier_value });
  collisionMap.set(key, entries);
}
const collisions = [...collisionMap.entries()]
  .filter(([, entries]) => new Set(entries.map(entry => entry.productId)).size > 1)
  .map(([identifier, entries]) => ({ identifier, products: [...new Set(entries.map(entry => entry.productId))], rawValues: [...new Set(entries.map(entry => entry.value))] }));
report.identifierCollisions = collisions.length;

if (apply) {
  const now = new Date().toISOString();
  const updateProduct = db.prepare(`
    UPDATE cannabis_products
    SET category_id=CASE WHEN category_id IS NULL THEN ? ELSE category_id END,
        category_source=CASE WHEN category_id IS NULL THEN ? ELSE category_source END,
        source_category=COALESCE(source_category,?),
        canonical_product_type=?,
        strain_type=COALESCE(strain_type,?),
        normalizer_version=?,
        normalized_at=?,
        updated_at=?
    WHERE id=?
  `);
  const updateIdentifier = db.prepare(`
    UPDATE cannabis_product_identifiers
    SET normalized_value=?,
        first_seen_at=COALESCE(first_seen_at,created_at),
        last_seen_at=COALESCE(last_seen_at,created_at),
        verification_state=COALESCE(verification_state,?)
    WHERE id=?
  `);

  db.exec('BEGIN');
  try {
    for (const { row, normalized } of normalizedRows) {
      updateProduct.run(
        normalized.categoryId,
        `normalizer-v${normalized.normalizerVersion}`,
        normalized.sourceCategory,
        normalized.canonicalProductType,
        normalized.strainType,
        normalized.normalizerVersion,
        now,
        now,
        row.id,
      );
    }
    for (const identifier of identifiers) {
      updateIdentifier.run(
        normalizeProductIdentifier(identifier.identifier_type, identifier.identifier_value) || null,
        identifier.verified ? 'verified' : 'unverified',
        identifier.id,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const unresolvedTop = [...unresolved.entries()]
  .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  .slice(0, 25)
  .map(([value, count]) => ({ value, count }));

console.log('\nGeoWeedo product taxonomy backfill');
console.log('=================================');
console.log(JSON.stringify(report, null, 2));

if (unresolvedTop.length) {
  console.log('\nTop Other / unmapped source values');
  console.table(unresolvedTop);
}

if (collisions.length) {
  console.log('\nNormalized identifier collisions (review before merging anything)');
  console.log(JSON.stringify(collisions.slice(0, 20), null, 2));
}

if (!apply) {
  console.log('\nDry run only. No product rows or identifier values were changed.');
  console.log('Run again with --apply after reviewing this report.');
} else {
  console.log('\nTaxonomy normalization applied. Existing non-null category assignments were preserved.');
}
