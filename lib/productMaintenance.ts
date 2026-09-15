import 'server-only';

import { getDatabase } from './sqlite';

type Db = ReturnType<typeof getDatabase>;

function tableExists(db: Db, table: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table));
}

function quoteIdentifier(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function columnsFor(db: Db, table: string) {
  if (!tableExists(db, table)) return [] as Array<{ name: string }>;
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
}

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function nullable(value: unknown) {
  const text = clean(value);
  return text || null;
}

function atomic<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }
}

export function normalizeProductName(brandName: unknown, productName: unknown) {
  return `${clean(brandName)} ${clean(productName)}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function ensureProductMaintenanceSchema(db: Db = getDatabase()) {
  if (!tableExists(db, 'cannabis_products')) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_product_merge_history (
      source_product_id TEXT PRIMARY KEY,
      target_product_id TEXT NOT NULL,
      source_brand_name TEXT,
      source_product_name TEXT NOT NULL,
      target_brand_name TEXT,
      target_product_name TEXT NOT NULL,
      merged_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cannabis_product_merge_target_idx
      ON cannabis_product_merge_history(target_product_id, merged_at DESC);
  `);
  return db;
}

export function resolveCanonicalProductId(productId: string, db: Db = getDatabase()) {
  ensureProductMaintenanceSchema(db);
  let current = clean(productId);
  if (!current) return current;
  const visited = new Set<string>();
  for (let depth = 0; depth < 20; depth += 1) {
    if (visited.has(current)) return current;
    visited.add(current);
    const row = db.prepare('SELECT target_product_id FROM cannabis_product_merge_history WHERE source_product_id=? LIMIT 1').get(current) as any;
    if (!row?.target_product_id) return current;
    current = String(row.target_product_id);
  }
  return current;
}

export function updateCanonicalProduct(input: { productId: string; brandName?: string | null; productName: string }, db: Db = getDatabase()) {
  ensureProductMaintenanceSchema(db);
  const productId = resolveCanonicalProductId(input.productId, db);
  const productName = clean(input.productName);
  const brandName = nullable(input.brandName);
  if (!productId || !productName) throw new Error('Product and product name are required.');

  const current = db.prepare('SELECT id,brand_name,product_name FROM cannabis_products WHERE id=? LIMIT 1').get(productId) as any;
  if (!current) throw new Error('Product was not found.');
  const normalized = normalizeProductName(brandName, productName);
  const duplicate = db.prepare(`
    SELECT id,brand_name,product_name
    FROM cannabis_products
    WHERE id<>? AND LOWER(TRIM(COALESCE(normalized_name,'')))=?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(productId, normalized) as any;
  if (duplicate) {
    const error = new Error(`Another product already uses this brand and product name: ${duplicate.brand_name ? `${duplicate.brand_name} · ` : ''}${duplicate.product_name}. Merge the duplicate records instead.`) as Error & { duplicateProductId?: string };
    error.duplicateProductId = String(duplicate.id);
    throw error;
  }

  const now = new Date().toISOString();
  atomic(db, () => {
    db.prepare(`UPDATE cannabis_products
      SET brand_name=?,product_name=?,normalized_name=?,updated_at=?
      WHERE id=?`).run(brandName, productName, normalized, now, productId);

    if (tableExists(db, 'dispensary_menu_items')) {
      db.prepare(`UPDATE dispensary_menu_items
        SET brand_name=?,updated_at=?
        WHERE product_id=?
          AND (brand_name IS NULL OR TRIM(brand_name)='' OR brand_name=? COLLATE NOCASE)`)
        .run(brandName, now, productId, current.brand_name || '');
    }
  });
  return db.prepare('SELECT * FROM cannabis_products WHERE id=?').get(productId) as any;
}

function countProductRows(db: Db, table: string, sourceProductId: string) {
  if (!tableExists(db, table)) return 0;
  const columns = columnsFor(db, table);
  if (!columns.some(column => column.name === 'product_id')) return 0;
  return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(table)} WHERE product_id=?`).get(sourceProductId) as any)?.n || 0);
}

function mergeProductMedia(db: Db, sourceProductId: string, targetProductId: string) {
  if (!tableExists(db, 'cannabis_product_media')) return;
  const columns = columnsFor(db, 'cannabis_product_media');
  if (!columns.some(column => column.name === 'image_url')) return;
  db.prepare(`
    DELETE FROM cannabis_product_media
    WHERE product_id=?
      AND EXISTS (
        SELECT 1 FROM cannabis_product_media target
        WHERE target.product_id=? AND target.image_url=cannabis_product_media.image_url
      )
  `).run(sourceProductId, targetProductId);
  db.prepare('UPDATE cannabis_product_media SET product_id=? WHERE product_id=?').run(targetProductId, sourceProductId);
  if (columns.some(column => column.name === 'is_primary')) {
    const primary = db.prepare(`SELECT id FROM cannabis_product_media WHERE product_id=? ORDER BY is_primary DESC,updated_at DESC,created_at DESC LIMIT 1`).get(targetProductId) as any;
    if (primary?.id) {
      db.prepare('UPDATE cannabis_product_media SET is_primary=CASE WHEN id=? THEN 1 ELSE 0 END WHERE product_id=?').run(primary.id, targetProductId);
    }
  }
}

function mergeLegacyCultivarLinks(db: Db, sourceProductId: string, targetProductId: string) {
  if (!tableExists(db, 'cannabis_product_cultivar_links')) return;
  const columns = columnsFor(db, 'cannabis_product_cultivar_links');
  if (!columns.some(column => column.name === 'cultivar_id')) return;
  db.prepare(`
    DELETE FROM cannabis_product_cultivar_links
    WHERE product_id=?
      AND EXISTS (
        SELECT 1 FROM cannabis_product_cultivar_links target
        WHERE target.product_id=? AND target.cultivar_id=cannabis_product_cultivar_links.cultivar_id
      )
  `).run(sourceProductId, targetProductId);
  db.prepare('UPDATE cannabis_product_cultivar_links SET product_id=? WHERE product_id=?').run(targetProductId, sourceProductId);
}

function mergePedigreeCultivarLinks(db: Db, sourceProductId: string, targetProductId: string) {
  if (!tableExists(db, 'cannabis_product_pedigree_cultivars')) return;
  const columns = new Set(columnsFor(db, 'cannabis_product_pedigree_cultivars').map(column => column.name));
  if (!columns.has('cultivar_id')) return;
  const sourceKey = columns.has('source_id') ? "COALESCE(source.source_id,'')" : "''";
  const targetKey = columns.has('source_id') ? "COALESCE(target.source_id,'')" : "''";
  db.prepare(`
    DELETE FROM cannabis_product_pedigree_cultivars AS source
    WHERE source.product_id=?
      AND EXISTS (
        SELECT 1 FROM cannabis_product_pedigree_cultivars target
        WHERE target.product_id=?
          AND target.cultivar_id=source.cultivar_id
          AND ${targetKey}=${sourceKey}
      )
  `).run(sourceProductId, targetProductId);
  db.prepare('UPDATE cannabis_product_pedigree_cultivars SET product_id=? WHERE product_id=?').run(targetProductId, sourceProductId);
}

function updateProductReferences(db: Db, sourceProductId: string, targetProductId: string) {
  const skip = new Set([
    'cannabis_products',
    'cannabis_product_merge_history',
    'cannabis_product_media',
    'cannabis_product_cultivar_links',
    'cannabis_product_pedigree_cultivars',
  ]);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  const updated: Record<string, number> = {};
  for (const { name } of tables) {
    if (skip.has(name)) continue;
    const productColumns = columnsFor(db, name)
      .map(column => column.name)
      .filter(column => column === 'product_id' || column.endsWith('_product_id'));
    for (const column of productColumns) {
      const result = db.prepare(`UPDATE ${quoteIdentifier(name)} SET ${quoteIdentifier(column)}=? WHERE ${quoteIdentifier(column)}=?`).run(targetProductId, sourceProductId);
      if (result.changes) updated[`${name}.${column}`] = Number(result.changes);
    }
  }
  return updated;
}

export function mergeCanonicalProducts(input: { sourceProductId: string; targetProductId: string }, db: Db = getDatabase()) {
  ensureProductMaintenanceSchema(db);
  const sourceProductId = clean(input.sourceProductId);
  let targetProductId = resolveCanonicalProductId(input.targetProductId, db);
  if (!sourceProductId || !targetProductId) throw new Error('Source and surviving product are required.');
  if (sourceProductId === targetProductId) throw new Error('Choose two different products to merge.');

  const source = db.prepare('SELECT * FROM cannabis_products WHERE id=? LIMIT 1').get(sourceProductId) as any;
  let target = db.prepare('SELECT * FROM cannabis_products WHERE id=? LIMIT 1').get(targetProductId) as any;
  if (!source) throw new Error('The duplicate product was not found or has already been merged.');
  if (!target) throw new Error('The surviving product was not found.');

  const counts = {
    batches: countProductRows(db, 'cannabis_batches', sourceProductId),
    identifiers: countProductRows(db, 'cannabis_product_identifiers', sourceProductId),
    variants: countProductRows(db, 'cannabis_product_variants', sourceProductId),
    menuItems: countProductRows(db, 'dispensary_menu_items', sourceProductId),
    qrScans: countProductRows(db, 'cannabis_qr_scans', sourceProductId),
    scanHistory: countProductRows(db, 'cannabis_scan_history', sourceProductId),
  };

  const now = new Date().toISOString();
  let referenceUpdates: Record<string, number>;
  try {
    referenceUpdates = atomic(db, () => {
      const productColumns = new Set(columnsFor(db, 'cannabis_products').map(column => column.name));
      const fillable = ['brand_name', 'product_type', 'net_contents', 'category_id', 'category_source', 'source_category', 'canonical_product_type', 'strain_type'];
      for (const column of fillable) {
        if (!productColumns.has(column)) continue;
        const targetValue = target[column];
        const sourceValue = source[column];
        if ((targetValue === null || targetValue === undefined || String(targetValue).trim() === '') && sourceValue !== null && sourceValue !== undefined && String(sourceValue).trim() !== '') {
          db.prepare(`UPDATE cannabis_products SET ${quoteIdentifier(column)}=? WHERE id=?`).run(sourceValue, targetProductId);
          target[column] = sourceValue;
        }
      }

      const effectiveBrand = target.brand_name || null;
      db.prepare('UPDATE cannabis_products SET normalized_name=?,updated_at=? WHERE id=?')
        .run(normalizeProductName(effectiveBrand, target.product_name), now, targetProductId);

      mergeProductMedia(db, sourceProductId, targetProductId);
      mergeLegacyCultivarLinks(db, sourceProductId, targetProductId);
      mergePedigreeCultivarLinks(db, sourceProductId, targetProductId);
      const updates = updateProductReferences(db, sourceProductId, targetProductId);

      db.prepare(`INSERT OR REPLACE INTO cannabis_product_merge_history
        (source_product_id,target_product_id,source_brand_name,source_product_name,target_brand_name,target_product_name,merged_at)
        VALUES (?,?,?,?,?,?,?)`)
        .run(sourceProductId, targetProductId, source.brand_name || null, source.product_name, effectiveBrand, target.product_name, now);

      db.prepare('DELETE FROM cannabis_products WHERE id=?').run(sourceProductId);
      return updates;
    });
  } catch (error) {
    throw new Error(`Merge was rolled back without deleting anything: ${error instanceof Error ? error.message : 'linked data could not be moved safely'}`);
  }

  targetProductId = resolveCanonicalProductId(targetProductId, db);
  target = db.prepare('SELECT * FROM cannabis_products WHERE id=? LIMIT 1').get(targetProductId) as any;
  return { sourceProductId, targetProductId, target, counts, referenceUpdates };
}
