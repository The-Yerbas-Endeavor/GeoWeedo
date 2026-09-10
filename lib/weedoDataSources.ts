import { getDatabase } from './sqlite.ts';

export type WeedoDataSourceId = 'sc-labs' | 'kannapedia' | 'cannlytics';
export type WeedoDataSourceState = 'idle' | 'running' | 'success' | 'error';

export const CANNLYTICS_REGIONS = [
  ['ca','California',71581],['co','Colorado',25798],['ct','Connecticut',19963],['fl','Florida',14573],
  ['hi','Hawaii',13485],['ma','Massachusetts',75164],['md','Maryland',105013],['mi','Michigan',89956],
  ['nv','Nevada',153064],['ny','New York',330],['or','Oregon',196900],['ri','Rhode Island',25832],
  ['ut','Utah',1230],['wa','Washington',202812],
] as const;

export const WEEDO_DATA_SOURCES = [
  {
    id: 'sc-labs' as const,
    label: 'SC Labs',
    kind: 'Verified laboratory chemistry',
    sourceUrl: 'https://client.sclabs.com/',
    description: 'Refresh current public SC Labs PhytoFacts records and update existing verified Product Chemistry batches.',
  },
  {
    id: 'cannlytics' as const,
    label: 'Cannlytics Cannabis Results',
    kind: 'Public laboratory / regulatory dataset',
    sourceUrl: 'https://huggingface.co/datasets/cannlytics/cannabis_results',
    description: 'Import and refresh Cannlytics lab-result datasets one state at a time. Existing records are hash-checked, changed rows are updated, and direct lab evidence is preserved when a matching batch already exists.',
  },
  {
    id: 'kannapedia' as const,
    label: 'Kannapedia',
    kind: 'Cultivar genetics',
    sourceUrl: 'https://kannapedia.net/strains',
    description: 'Refresh the public Kannapedia cultivar library, genetics metadata, and registrant-reported chemistry.',
  },
] as const;

function ensureSourceSchema() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_data_sources (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_url TEXT,
      state TEXT NOT NULL DEFAULT 'idle',
      last_started_at TEXT,
      last_completed_at TEXT,
      last_error TEXT,
      last_summary_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cannlytics_state_sync (
      state_code TEXT PRIMARY KEY,
      upstream_records INTEGER,
      imported_records INTEGER NOT NULL DEFAULT 0,
      linked_existing INTEGER NOT NULL DEFAULT 0,
      unchanged_records INTEGER NOT NULL DEFAULT 0,
      skipped_records INTEGER NOT NULL DEFAULT 0,
      failed_records INTEGER NOT NULL DEFAULT 0,
      last_started_at TEXT,
      last_completed_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  if (tableExists(db, 'cannabis_batches')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS cannabis_batches_verified_tested_idx ON cannabis_batches(verified, tested_at DESC);
      CREATE INDEX IF NOT EXISTS cannabis_batches_source_verified_idx ON cannabis_batches(source_name, verified);
      CREATE INDEX IF NOT EXISTS cannabis_batches_producer_idx ON cannabis_batches(producer_name);
    `);
  }
  if (tableExists(db, 'cannabis_products')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS cannabis_products_brand_idx ON cannabis_products(brand_name);
      CREATE INDEX IF NOT EXISTS cannabis_products_type_idx ON cannabis_products(product_type);
    `);
  }

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO cannabis_data_sources
      (id, label, source_kind, source_url, state, updated_at)
    VALUES (?, ?, ?, ?, 'idle', ?)
  `);
  for (const source of WEEDO_DATA_SOURCES) insert.run(source.id, source.label, source.kind, source.sourceUrl, now);

  const regionInsert = db.prepare(`
    INSERT OR IGNORE INTO cannlytics_state_sync (state_code, upstream_records, updated_at)
    VALUES (?, ?, ?)
  `);
  for (const [code,, upstream] of CANNLYTICS_REGIONS) regionInsert.run(code, upstream, now);
  return db;
}

export function beginSourceUpdate(sourceId: WeedoDataSourceId) {
  const db = ensureSourceSchema();
  const now = new Date().toISOString();
  db.prepare(`UPDATE cannabis_data_sources SET state='running',last_started_at=?,last_error=NULL,updated_at=? WHERE id=?`).run(now, now, sourceId);
}

export function finishSourceUpdate(sourceId: WeedoDataSourceId, summary?: unknown) {
  const db = ensureSourceSchema();
  const now = new Date().toISOString();
  db.prepare(`UPDATE cannabis_data_sources SET state='success',last_completed_at=?,last_error=NULL,last_summary_json=?,updated_at=? WHERE id=?`)
    .run(now, summary === undefined ? null : JSON.stringify(summary), now, sourceId);
}

export function failSourceUpdate(sourceId: WeedoDataSourceId, error: unknown) {
  const db = ensureSourceSchema();
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error || 'Source update failed.');
  db.prepare(`UPDATE cannabis_data_sources SET state='error',last_completed_at=?,last_error=?,updated_at=? WHERE id=?`)
    .run(now, message.slice(0, 2000), now, sourceId);
}

function tableExists(db: any, name: string) {
  return Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

function countScLabs(db: any) {
  if (!tableExists(db, 'cannabis_batches')) return { records:0, products:0, primaryLabel:'products', secondaryCount:0, secondaryLabel:'licensed businesses' };
  const row = db.prepare(`SELECT COUNT(*) records,COUNT(DISTINCT product_id) products,COUNT(DISTINCT producer_name) businesses FROM cannabis_batches WHERE source_name='SC Labs' AND verified=1`).get() as any;
  return { records:Number(row?.records||0), products:Number(row?.products||0), primaryLabel:'products', secondaryCount:Number(row?.businesses||0), secondaryLabel:'licensed businesses' };
}

function countKannapedia(db: any) {
  if (!tableExists(db, 'cannabis_cultivars')) return { records:0, products:0, primaryLabel:'cultivars', secondaryCount:0, secondaryLabel:'registrants' };
  const row = db.prepare(`SELECT COUNT(*) records,COUNT(DISTINCT normalized_name) cultivars,COUNT(DISTINCT registrant) registrants FROM cannabis_cultivars WHERE source_name='Kannapedia'`).get() as any;
  return { records:Number(row?.records||0), products:Number(row?.cultivars||0), primaryLabel:'cultivars', secondaryCount:Number(row?.registrants||0), secondaryLabel:'registrants' };
}

function countCannlytics(db: any) {
  const hasRecords = tableExists(db, 'cannlytics_source_records');
  const hasBatches = tableExists(db, 'cannabis_batches');
  const records = hasRecords ? Number((db.prepare(`SELECT COUNT(*) count FROM cannlytics_source_records`).get() as any)?.count || 0) : 0;
  const products = hasBatches ? Number((db.prepare(`SELECT COUNT(DISTINCT product_id) count FROM cannabis_batches WHERE source_name='Cannlytics' AND verified=1`).get() as any)?.count || 0) : 0;
  const importedByState = new Map<string, number>();
  if (hasRecords) {
    for (const row of db.prepare(`SELECT state_code,COUNT(*) count FROM cannlytics_source_records GROUP BY state_code`).all() as any[]) importedByState.set(row.state_code, Number(row.count||0));
  }
  const syncRows = new Map<string, any>((db.prepare(`SELECT * FROM cannlytics_state_sync`).all() as any[]).map(row => [row.state_code, row]));
  const regions = CANNLYTICS_REGIONS.map(([code,label,upstreamRecords]) => {
    const sync = syncRows.get(code);
    return {
      code, label, upstreamRecords,
      importedRecords: importedByState.get(code) || 0,
      lastStartedAt: sync?.last_started_at || null,
      lastCompletedAt: sync?.last_completed_at || null,
      lastError: sync?.last_error || null,
    };
  });
  return { records, products, primaryLabel:'products', secondaryCount:regions.filter(row => row.importedRecords > 0).length, secondaryLabel:'states imported', regions };
}

export function getSourceSummaries() {
  const db = ensureSourceSchema();
  const rows = db.prepare(`SELECT * FROM cannabis_data_sources ORDER BY label COLLATE NOCASE`).all() as any[];
  return rows.map(row => {
    const definition = WEEDO_DATA_SOURCES.find(source => source.id === row.id);
    const counts = row.id === 'sc-labs' ? countScLabs(db) : row.id === 'cannlytics' ? countCannlytics(db) : countKannapedia(db);
    let lastSummary: unknown = null;
    try { lastSummary = row.last_summary_json ? JSON.parse(row.last_summary_json) : null; } catch {}
    return {
      id:row.id,label:row.label,kind:row.source_kind,sourceUrl:row.source_url,description:definition?.description || '',
      state:row.state as WeedoDataSourceState,lastStartedAt:row.last_started_at,lastCompletedAt:row.last_completed_at,
      lastError:row.last_error,lastSummary,...counts,
    };
  });
}

export function sourceCanStart(sourceId: WeedoDataSourceId) {
  const source = getSourceSummaries().find(row => row.id === sourceId);
  if (!source) return false;
  if (source.state !== 'running') return true;
  if (!source.lastStartedAt) return true;
  const started = new Date(source.lastStartedAt).getTime();
  return !Number.isFinite(started) || Date.now() - started > 3 * 60 * 60 * 1000;
}
