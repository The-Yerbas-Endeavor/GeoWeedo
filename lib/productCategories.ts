import { getDatabase } from './sqlite';

type Db = ReturnType<typeof getDatabase>;

export type ProductCategory = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  active: number;
};

type CategorySeed = { id: string; slug: string; name: string; sort: number; aliases: string[] };

const CATEGORY_SEEDS: CategorySeed[] = [
  { id: 'cat-flower', slug: 'flower', name: 'Flower', sort: 10, aliases: ['flower', 'bud', 'cannabis flower'] },
  { id: 'cat-prerolls', slug: 'pre-rolls', name: 'Pre-Rolls', sort: 20, aliases: ['pre roll', 'pre rolls', 'pre-roll', 'pre-rolls', 'preroll', 'prerolls', 'joint', 'joints', 'infused pre roll', 'infused pre-roll'] },
  { id: 'cat-vapes', slug: 'vapes', name: 'Vapes', sort: 30, aliases: ['vape', 'vapes', 'vaporizer', 'vaporizer cartridge', 'cartridge', 'cartridges', 'cart', 'carts', 'disposable vape', 'disposable', 'pod', 'pods'] },
  { id: 'cat-concentrates', slug: 'concentrates', name: 'Concentrates', sort: 40, aliases: ['concentrate', 'concentrates', 'extract', 'extracts', 'resin', 'live resin', 'rosin', 'live rosin', 'wax', 'badder', 'budder', 'shatter', 'sauce', 'diamonds', 'hash', 'hashish'] },
  { id: 'cat-edibles', slug: 'edibles', name: 'Edibles', sort: 50, aliases: ['edible', 'edibles', 'gummy', 'gummies', 'chocolate', 'chocolates', 'candy', 'candies', 'baked good', 'baked goods'] },
  { id: 'cat-beverages', slug: 'beverages', name: 'Beverages', sort: 60, aliases: ['beverage', 'beverages', 'drink', 'drinks', 'shot', 'shots', 'drink mix', 'drink mixes', 'mixer', 'mixers'] },
  { id: 'cat-tinctures', slug: 'tinctures', name: 'Tinctures', sort: 70, aliases: ['tincture', 'tinctures', 'drops', 'oral drops'] },
  { id: 'cat-capsules', slug: 'capsules-tablets', name: 'Capsules & Tablets', sort: 80, aliases: ['capsule', 'capsules', 'tablet', 'tablets', 'pill', 'pills', 'softgel', 'softgels'] },
  { id: 'cat-topicals', slug: 'topicals', name: 'Topicals', sort: 90, aliases: ['topical', 'topicals', 'balm', 'balms', 'salve', 'salves', 'lotion', 'lotions', 'cream', 'creams', 'patch', 'patches'] },
  { id: 'cat-sublinguals', slug: 'sublinguals', name: 'Sublinguals', sort: 100, aliases: ['sublingual', 'sublinguals', 'strip', 'strips', 'lozenge', 'lozenges'] },
  { id: 'cat-seeds-clones', slug: 'seeds-clones', name: 'Seeds & Clones', sort: 110, aliases: ['seed', 'seeds', 'clone', 'clones', 'plant', 'plants'] },
  { id: 'cat-other', slug: 'other', name: 'Other / Uncategorized', sort: 999, aliases: ['other', 'uncategorized', 'unknown'] },
];

function normalize(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function tableExists(db: Db, table: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table));
}

function ensureColumn(db: Db, table: string, column: string, definition: string) {
  if (!tableExists(db, table)) return;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (!columns.some(row => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function seedCategories(db: Db) {
  const now = new Date().toISOString();
  const categoryStatement = db.prepare(`
    INSERT INTO cannabis_product_categories (id,slug,name,description,sort_order,active,created_at,updated_at)
    VALUES (?,?,?,?,?,1,?,?)
    ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name,sort_order=excluded.sort_order,active=1,updated_at=excluded.updated_at
  `);
  const aliasStatement = db.prepare(`
    INSERT INTO cannabis_product_category_aliases (id,category_id,alias,normalized_alias,source_scope,created_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(normalized_alias,source_scope) DO UPDATE SET category_id=excluded.category_id,alias=excluded.alias
  `);
  for (const category of CATEGORY_SEEDS) {
    categoryStatement.run(category.id, category.slug, category.name, null, category.sort, now, now);
    for (const alias of category.aliases) {
      const normalized = normalize(alias);
      aliasStatement.run(`alias-${category.id}-${normalized.replace(/\s+/g, '-')}`, category.id, alias, normalized, '*', now);
    }
  }
}

function resolveWithoutEnsure(raw: unknown, db: Db): ProductCategory | null {
  const value = normalize(raw);
  if (!value) return null;
  const exact = db.prepare(`
    SELECT c.id,c.slug,c.name,c.description,c.sort_order,c.active
    FROM cannabis_product_category_aliases a
    JOIN cannabis_product_categories c ON c.id=a.category_id
    WHERE a.normalized_alias=? AND c.active=1
    ORDER BY c.sort_order LIMIT 1
  `).get(value) as ProductCategory | undefined;
  if (exact) return exact;

  const aliases = db.prepare(`
    SELECT a.normalized_alias,c.id,c.slug,c.name,c.description,c.sort_order,c.active
    FROM cannabis_product_category_aliases a
    JOIN cannabis_product_categories c ON c.id=a.category_id
    WHERE c.active=1 AND a.normalized_alias NOT IN ('other','uncategorized','unknown')
    ORDER BY LENGTH(a.normalized_alias) DESC,c.sort_order
  `).all() as Array<ProductCategory & { normalized_alias: string }>;
  const padded = ` ${value} `;
  const hit = aliases.find(row => padded.includes(` ${row.normalized_alias} `));
  return hit ? { id: hit.id, slug: hit.slug, name: hit.name, description: hit.description, sort_order: hit.sort_order, active: hit.active } : null;
}

function backfillWithoutEnsure(db: Db) {
  if (!tableExists(db, 'cannabis_products')) return { products: 0, menuItems: 0 };
  let products = 0;
  let menuItems = 0;
  const now = new Date().toISOString();

  const productRows = db.prepare('SELECT id,product_type FROM cannabis_products WHERE category_id IS NULL').all() as Array<{ id: string; product_type: string | null }>;
  const updateProduct = db.prepare("UPDATE cannabis_products SET category_id=?,category_source='auto',updated_at=? WHERE id=? AND category_id IS NULL");
  for (const row of productRows) {
    const category = resolveWithoutEnsure(row.product_type, db);
    if (!category) continue;
    updateProduct.run(category.id, now, row.id);
    products += 1;
  }

  if (tableExists(db, 'dispensary_menu_items')) {
    const rows = db.prepare(`
      SELECT mi.id,mi.category,p.category_id AS product_category_id
      FROM dispensary_menu_items mi
      LEFT JOIN cannabis_products p ON p.id=mi.product_id
      WHERE mi.category_id IS NULL
    `).all() as Array<{ id: string; category: string | null; product_category_id: string | null }>;
    const updateMenu = db.prepare('UPDATE dispensary_menu_items SET category_id=?,category_source=?,updated_at=? WHERE id=? AND category_id IS NULL');
    for (const row of rows) {
      const category = resolveWithoutEnsure(row.category, db);
      const categoryId = category?.id || row.product_category_id || null;
      if (!categoryId) continue;
      updateMenu.run(categoryId, category ? 'auto' : 'product', now, row.id);
      menuItems += 1;
    }
  }
  return { products, menuItems };
}

export function ensureProductCategorySchema(db: Db = getDatabase()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_product_categories (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, parent_id TEXT,
      description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(parent_id) REFERENCES cannabis_product_categories(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS cannabis_product_category_aliases (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL, alias TEXT NOT NULL, normalized_alias TEXT NOT NULL,
      source_scope TEXT NOT NULL DEFAULT '*', created_at TEXT NOT NULL,
      UNIQUE(normalized_alias,source_scope),
      FOREIGN KEY(category_id) REFERENCES cannabis_product_categories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS cannabis_product_categories_active_idx ON cannabis_product_categories(active,sort_order,name);
    CREATE INDEX IF NOT EXISTS cannabis_product_category_aliases_category_idx ON cannabis_product_category_aliases(category_id,normalized_alias);
  `);
  ensureColumn(db, 'cannabis_products', 'category_id', 'TEXT');
  ensureColumn(db, 'cannabis_products', 'category_source', 'TEXT');
  ensureColumn(db, 'dispensary_menu_items', 'category_id', 'TEXT');
  ensureColumn(db, 'dispensary_menu_items', 'category_source', 'TEXT');
  if (tableExists(db, 'cannabis_products')) db.exec('CREATE INDEX IF NOT EXISTS cannabis_products_category_idx ON cannabis_products(category_id)');
  if (tableExists(db, 'dispensary_menu_items')) db.exec('CREATE INDEX IF NOT EXISTS dispensary_menu_items_category_id_idx ON dispensary_menu_items(category_id,active)');
  seedCategories(db);
  backfillWithoutEnsure(db);
  return db;
}

export function listProductCategories(db: Db = getDatabase()): ProductCategory[] {
  ensureProductCategorySchema(db);
  return db.prepare('SELECT id,slug,name,description,sort_order,active FROM cannabis_product_categories WHERE active=1 ORDER BY sort_order,name COLLATE NOCASE').all() as ProductCategory[];
}

export function getProductCategory(categoryId: string | null | undefined, db: Db = getDatabase()): ProductCategory | null {
  if (!categoryId) return null;
  ensureProductCategorySchema(db);
  return (db.prepare('SELECT id,slug,name,description,sort_order,active FROM cannabis_product_categories WHERE id=? AND active=1 LIMIT 1').get(categoryId) as ProductCategory | undefined) || null;
}

export function resolveProductCategory(raw: unknown, db: Db = getDatabase()): ProductCategory | null {
  ensureProductCategorySchema(db);
  return resolveWithoutEnsure(raw, db);
}

export function backfillProductCategories(db: Db = getDatabase()) {
  ensureProductCategorySchema(db);
  return backfillWithoutEnsure(db);
}

export function assignProductCategory(productId: string, categoryId: string, source = 'admin', db: Db = getDatabase()) {
  ensureProductCategorySchema(db);
  const category = getProductCategory(categoryId, db);
  if (!category) throw new Error('Product category was not found.');
  const result = db.prepare('UPDATE cannabis_products SET category_id=?,category_source=?,updated_at=? WHERE id=?').run(category.id, source, new Date().toISOString(), productId);
  if (!Number(result.changes || 0)) throw new Error('Product was not found.');
  return category;
}

export function assignMenuItemCategory(itemId: string, categoryId: string, source = 'owner', db: Db = getDatabase()) {
  ensureProductCategorySchema(db);
  const category = getProductCategory(categoryId, db);
  if (!category) throw new Error('Product category was not found.');
  const result = db.prepare('UPDATE dispensary_menu_items SET category_id=?,category_source=?,updated_at=? WHERE id=?').run(category.id, source, new Date().toISOString(), itemId);
  if (!Number(result.changes || 0)) throw new Error('Menu item was not found.');
  return category;
}
