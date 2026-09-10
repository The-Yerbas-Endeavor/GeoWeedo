import { getDatabase } from './sqlite.ts';

export type WeedoDataSourceId = 'sc-labs' | 'kannapedia';
export type WeedoDataSourceState = 'idle' | 'running' | 'success' | 'error';

export const WEEDO_DATA_SOURCES = [
  {
    id: 'sc-labs' as const,
    label: 'SC Labs',
    kind: 'Verified laboratory chemistry',
    sourceUrl: 'https://client.sclabs.com/',
    description: 'Refresh current public SC Labs PhytoFacts records and update existing verified Product Chemistry batches.',
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
  `);

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO cannabis_data_sources
      (id, label, source_kind, source_url, state, updated_at)
    VALUES (?, ?, ?, ?, 'idle', ?)
  `);
  for (const source of WEEDO_DATA_SOURCES) {
    insert.run(source.id, source.label, source.kind, source.sourceUrl, now);
  }
  return db;
}

export function beginSourceUpdate(sourceId: WeedoDataSourceId) {
  const db = ensureSourceSchema();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE cannabis_data_sources
    SET state='running', last_started_at=?, last_error=NULL, updated_at=?
    WHERE id=?
  `).run(now, now, sourceId);
}

export function finishSourceUpdate(sourceId: WeedoDataSourceId, summary?: unknown) {
  const db = ensureSourceSchema();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE cannabis_data_sources
    SET state='success', last_completed_at=?, last_error=NULL, last_summary_json=?, updated_at=?
    WHERE id=?
  `).run(now, summary === undefined ? null : JSON.stringify(summary), now, sourceId);
}

export function failSourceUpdate(sourceId: WeedoDataSourceId, error: unknown) {
  const db = ensureSourceSchema();
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error || 'Source update failed.');
  db.prepare(`
    UPDATE cannabis_data_sources
    SET state='error', last_completed_at=?, last_error=?, updated_at=?
    WHERE id=?
  `).run(now, message.slice(0, 2000), now, sourceId);
}

function countScLabs(db: any) {
  const row = db.prepare(`
    SELECT COUNT(*) AS records,
           COUNT(DISTINCT product_id) AS products,
           COUNT(DISTINCT producer_name) AS businesses
    FROM cannabis_batches
    WHERE source_name='SC Labs' AND verified=1
  `).get() as any;
  return {
    records: Number(row?.records || 0),
    products: Number(row?.products || 0),
    secondaryCount: Number(row?.businesses || 0),
    secondaryLabel: 'licensed businesses',
  };
}

function countKannapedia(db: any) {
  const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='cannabis_cultivars'`).get();
  if (!hasTable) return { records: 0, products: 0, secondaryCount: 0, secondaryLabel: 'registrants' };
  const row = db.prepare(`
    SELECT COUNT(*) AS records,
           COUNT(DISTINCT normalized_name) AS cultivars,
           COUNT(DISTINCT registrant) AS registrants
    FROM cannabis_cultivars
    WHERE source_name='Kannapedia'
  `).get() as any;
  return {
    records: Number(row?.records || 0),
    products: Number(row?.cultivars || 0),
    secondaryCount: Number(row?.registrants || 0),
    secondaryLabel: 'registrants',
  };
}

export function getSourceSummaries() {
  const db = ensureSourceSchema();
  const rows = db.prepare(`SELECT * FROM cannabis_data_sources ORDER BY label COLLATE NOCASE`).all() as any[];
  return rows.map(row => {
    const definition = WEEDO_DATA_SOURCES.find(source => source.id === row.id);
    const counts = row.id === 'sc-labs' ? countScLabs(db) : countKannapedia(db);
    let lastSummary: unknown = null;
    try { lastSummary = row.last_summary_json ? JSON.parse(row.last_summary_json) : null; } catch {}
    return {
      id: row.id,
      label: row.label,
      kind: row.source_kind,
      sourceUrl: row.source_url,
      description: definition?.description || '',
      state: row.state as WeedoDataSourceState,
      lastStartedAt: row.last_started_at,
      lastCompletedAt: row.last_completed_at,
      lastError: row.last_error,
      lastSummary,
      ...counts,
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
