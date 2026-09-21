import { getDatabase } from './sqlite.ts';

type Db = ReturnType<typeof getDatabase>;

function tableExists(db: Db, table: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table));
}

function ensureColumn(db: Db, table: string, column: string, definition: string) {
  if (!tableExists(db, table)) return;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (!columns.some(row => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function normalizeProductIdentifier(identifierType: unknown, value: unknown) {
  const type = String(identifierType ?? '').trim().toLowerCase();
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (['upc', 'upc-a', 'upca', 'ean', 'ean-8', 'ean-13', 'gtin', 'gtin-12', 'gtin-13', 'gtin-14'].includes(type)) {
    return raw.replace(/\D+/g, '');
  }
  return raw;
}

let schemaReady = false;

export function ensureProductIdentitySchema(db: Db = getDatabase()) {
  if (schemaReady) return db;
  if (!tableExists(db, 'cannabis_products')) return db;

  ensureColumn(db, 'cannabis_products', 'source_category', 'TEXT');
  ensureColumn(db, 'cannabis_products', 'canonical_product_type', 'TEXT');
  ensureColumn(db, 'cannabis_products', 'strain_type', 'TEXT');
  ensureColumn(db, 'cannabis_products', 'normalizer_version', 'INTEGER');
  ensureColumn(db, 'cannabis_products', 'normalized_at', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      variant_name TEXT,
      package_size TEXT,
      package_unit TEXT,
      unit_count REAL,
      net_quantity REAL,
      net_quantity_unit TEXT,
      total_thc_mg REAL,
      total_cbd_mg REAL,
      source_name TEXT,
      source_record_id TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS cannabis_product_variants_product_idx
      ON cannabis_product_variants(product_id,active,verified);
    CREATE INDEX IF NOT EXISTS cannabis_product_variants_source_idx
      ON cannabis_product_variants(source_name,source_record_id);
  `);

  ensureColumn(db, 'cannabis_product_identifiers', 'variant_id', 'TEXT');
  ensureColumn(db, 'cannabis_product_identifiers', 'normalized_value', 'TEXT');
  ensureColumn(db, 'cannabis_product_identifiers', 'source_record_id', 'TEXT');
  ensureColumn(db, 'cannabis_product_identifiers', 'first_seen_at', 'TEXT');
  ensureColumn(db, 'cannabis_product_identifiers', 'last_seen_at', 'TEXT');
  ensureColumn(db, 'cannabis_product_identifiers', 'verification_state', 'TEXT');
  ensureColumn(db, 'cannabis_batches', 'variant_id', 'TEXT');
  ensureColumn(db, 'dispensary_menu_items', 'product_variant_id', 'TEXT');

  if (tableExists(db, 'cannabis_product_identifiers')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS cannabis_product_identifiers_normalized_idx
        ON cannabis_product_identifiers(identifier_type,normalized_value);
      CREATE INDEX IF NOT EXISTS cannabis_product_identifiers_variant_idx
        ON cannabis_product_identifiers(variant_id,identifier_type);
    `);
  }
  if (tableExists(db, 'cannabis_batches')) {
    db.exec('CREATE INDEX IF NOT EXISTS cannabis_batches_variant_idx ON cannabis_batches(variant_id,tested_at DESC)');
  }
  if (tableExists(db, 'dispensary_menu_items')) {
    db.exec('CREATE INDEX IF NOT EXISTS dispensary_menu_items_variant_idx ON dispensary_menu_items(product_variant_id,active)');
  }

  schemaReady = true;
  return db;
}
