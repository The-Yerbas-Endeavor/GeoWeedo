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
    label: 'Cannlytics Product & Lab Data',
    kind: 'Cannlytics Cannabis Results dataset',
    sourceUrl: 'https://huggingface.co/datasets/cannlytics/cannabis_results',
    description: 'Official GeoWeedo Cannlytics importer. Refresh product, batch/COA, cannabinoid, terpene and compliance data one state at a time from the Cannlytics Cannabis Results dataset. Large states are checkpointed and resumable; stronger direct-lab evidence is preserved.',
  },
  {
    id: 'kannapedia' as const,
    label: 'Kannapedia',
    kind: 'Cultivar genetics',
    sourceUrl: 'https://kannapedia.net/strains',
    description: 'Refresh the public Kannapedia cultivar library, genetics metadata, and registrant-reported chemistry.',
  },
] as const;

const SOURCE_HEARTBEAT_DELAYED_MS = 90 * 1000;
const SOURCE_STALE_MS = 10 * 60 * 1000;
let sourceSchemaReady = false;

function tableExists(db: any, name: string) {
  return Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

function ensureColumn(db: any, table: string, column: string, definition: string) {
  if (!tableExists(db, table)) return;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name?:string}>;
  if (!columns.some(row => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function sourceSchemaExists(db: any) {
  try {
    for (const table of ['cannabis_data_sources', 'cannlytics_state_sync']) {
      if (!tableExists(db, table)) return false;
    }
    const columns = new Set((db.prepare('PRAGMA table_info(cannlytics_state_sync)').all() as Array<{name?:string}>)
      .map(row => String(row.name || '')).filter(Boolean));
    return ['next_row_offset','processed_records','last_progress_at'].every(column => columns.has(column));
  } catch {
    return false;
  }
}

function ensureSourceSchema() {
  const db = getDatabase();
  if (sourceSchemaReady) return db;

  // The admin status endpoint is polled while imports run. Once schema is
  // already present, keep that path read-only instead of replaying CREATE /
  // ALTER / seed statements against the same live SQLite database.
  if (sourceSchemaExists(db)) {
    sourceSchemaReady = true;
    return db;
  }

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
  ensureColumn(db, 'cannlytics_state_sync', 'next_row_offset', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'cannlytics_state_sync', 'processed_records', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'cannlytics_state_sync', 'last_progress_at', 'TEXT');

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
  sourceSchemaReady = true;
  return db;
}

export function beginSourceUpdate(sourceId: WeedoDataSourceId) {
  const db = ensureSourceSchema();
  const now = new Date().toISOString();
  db.prepare(`UPDATE cannabis_data_sources SET state='running',last_started_at=?,last_error=NULL,updated_at=? WHERE id=?`).run(now, now, sourceId);
}

export function heartbeatSourceUpdate(sourceId: WeedoDataSourceId) {
  const db = ensureSourceSchema();
  const now = new Date().toISOString();
  db.prepare(`UPDATE cannabis_data_sources SET updated_at=? WHERE id=? AND state='running'`).run(now, sourceId);
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
  db.prepare(`UPDATE cannabis_data_sources SET state='error',last_error=?,updated_at=? WHERE id=?`)
    .run(message.slice(0, 2000), now, sourceId);
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

let cannlyticsProductCountCache: { value: number; at: number } | null = null;

function countCannlytics(db: any) {
  const hasBatches = tableExists(db, 'cannabis_batches');
  const syncRows = new Map<string, any>();
  for (const row of db.prepare(`SELECT * FROM cannlytics_state_sync`).all() as any[]) {
    syncRows.set(String(row.state_code), row);
  }

  // State checkpoints already store tracked record counts, so the status page
  // does not need to GROUP BY the entire source-record table every refresh.
  let records = 0;
  const importedByState = new Map<string, number>();
  for (const [code, row] of syncRows) {
    const imported = Number(row?.imported_records || 0);
    importedByState.set(code, imported);
    records += imported;
  }

  // COUNT(DISTINCT product_id) over a large batch table is useful but not
  // heartbeat-critical. Cache it for one minute while the importer runs.
  const nowMs = Date.now();
  let products = cannlyticsProductCountCache?.value ?? 0;
  if (!cannlyticsProductCountCache || nowMs - cannlyticsProductCountCache.at >= 60_000) {
    products = hasBatches
      ? Number((db.prepare(`SELECT COUNT(DISTINCT product_id) count FROM cannabis_batches WHERE source_name='Cannlytics' AND verified=1`).get() as any)?.count || 0)
      : 0;
    cannlyticsProductCountCache = { value: products, at: nowMs };
  }
  const regions = CANNLYTICS_REGIONS.map(([code,label,configuredUpstreamRecords]) => {
    const sync = syncRows.get(code);
    const syncedUpstreamRecords = Number(sync?.upstream_records || 0);
    const upstreamRecords = syncedUpstreamRecords > 0 ? syncedUpstreamRecords : configuredUpstreamRecords;
    const importedRecords = importedByState.get(code) || 0;
    const processedRecords = Number(sync?.processed_records || 0);
    return {
      code, label, upstreamRecords, importedRecords, processedRecords,
      nextRowOffset: Number(sync?.next_row_offset || 0),
      progressPercent: upstreamRecords ? Math.min(100, Math.round((processedRecords / upstreamRecords) * 1000) / 10) : 0,
      lastStartedAt: sync?.last_started_at || null,
      lastCompletedAt: sync?.last_completed_at || null,
      lastProgressAt: sync?.last_progress_at || null,
      lastError: sync?.last_error || null,
      resumable: Number(sync?.next_row_offset || 0) > 0 && !sync?.last_completed_at,
    };
  });
  return { records, products, primaryLabel:'products', secondaryCount:regions.filter(row => row.importedRecords > 0).length, secondaryLabel:'states imported', regions };
}

function runningHeartbeatState(row: any) {
  if (row?.state !== 'running') return { stale:false, heartbeatDelayed:false, heartbeatAgeMs:null as number|null };
  const heartbeat = new Date(row.updated_at || row.last_started_at || '').getTime();
  if (!Number.isFinite(heartbeat)) return { stale:true, heartbeatDelayed:true, heartbeatAgeMs:null as number|null };
  const heartbeatAgeMs = Math.max(0, Date.now() - heartbeat);
  return {
    stale: heartbeatAgeMs > SOURCE_STALE_MS,
    heartbeatDelayed: heartbeatAgeMs > SOURCE_HEARTBEAT_DELAYED_MS,
    heartbeatAgeMs,
  };
}

export function getSourceSummaries() {
  const db = ensureSourceSchema();
  const rows = db.prepare(`SELECT * FROM cannabis_data_sources ORDER BY label COLLATE NOCASE`).all() as any[];
  return rows.map(row => {
    const definition = WEEDO_DATA_SOURCES.find(source => source.id === row.id);
    const counts = row.id === 'sc-labs' ? countScLabs(db) : row.id === 'cannlytics' ? countCannlytics(db) : countKannapedia(db);
    let lastSummary: unknown = null;
    try { lastSummary = row.last_summary_json ? JSON.parse(row.last_summary_json) : null; } catch {}
    const heartbeat = runningHeartbeatState(row);
    return {
      id:row.id,label:definition?.label || row.label,kind:definition?.kind || row.source_kind,sourceUrl:definition?.sourceUrl || row.source_url,description:definition?.description || '',
      state:(heartbeat.stale ? 'error' : row.state) as WeedoDataSourceState,lastStartedAt:row.last_started_at,lastCompletedAt:row.last_completed_at,
      lastError:heartbeat.stale ? 'The previous update stopped reporting progress. It is safe to resume from the last Cannlytics checkpoint.' : row.last_error,
      lastHeartbeatAt:row.updated_at,...heartbeat,lastSummary,...counts,
    };
  });
}

export function sourceCanStart(sourceId: WeedoDataSourceId) {
  const source = getSourceSummaries().find(row => row.id === sourceId);
  if (!source) return false;
  return source.state !== 'running';
}
