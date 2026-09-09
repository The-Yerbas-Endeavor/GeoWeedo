import crypto from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';

export type LabDiscoveryItem = { externalId: string; sourceUrl: string };
export type LabImportResult = { productId: string; batchId: string; analyteCount: number; sampleId?: string };
export type LabProvider = {
  id: string;
  name: string;
  discover: (options?: { maxItems?: number }) => Promise<LabDiscoveryItem[]>;
  fetchAndNormalize: (item: LabDiscoveryItem) => Promise<any>;
  fingerprint: (normalized: any) => string;
  ingest: (normalized: any) => LabImportResult;
};

export type LabIngestionSummary = {
  runId: string;
  provider: string;
  discovered: number;
  imported: number;
  unchanged: number;
  failed: number;
  errors: Array<{ sourceUrl: string; error: string }>;
};

function ensureSchema() {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_lab_ingestion_runs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      discovered_count INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      unchanged_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS cannabis_lab_ingestion_items (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      fingerprint TEXT,
      product_id TEXT,
      batch_id TEXT,
      status TEXT NOT NULL DEFAULT 'discovered',
      last_error TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_checked_at TEXT,
      last_imported_at TEXT,
      UNIQUE(provider, external_id)
    );
    CREATE INDEX IF NOT EXISTS cannabis_lab_ingestion_runs_provider_idx ON cannabis_lab_ingestion_runs(provider, started_at DESC);
    CREATE INDEX IF NOT EXISTS cannabis_lab_ingestion_items_status_idx ON cannabis_lab_ingestion_items(provider, status, last_checked_at);
    CREATE UNIQUE INDEX IF NOT EXISTS cannabis_lab_ingestion_items_url_idx ON cannabis_lab_ingestion_items(provider, source_url);
  `);
  return db;
}

export function ensureLabIngestionSchema() { ensureSchema(); }

export function recentLabIngestionRuns(provider?: string, limit = 20) {
  const db = ensureSchema();
  if (provider) return db.prepare(`SELECT * FROM cannabis_lab_ingestion_runs WHERE provider=? ORDER BY started_at DESC LIMIT ?`).all(provider, Math.max(1, Math.min(limit, 100)));
  return db.prepare(`SELECT * FROM cannabis_lab_ingestion_runs ORDER BY started_at DESC LIMIT ?`).all(Math.max(1, Math.min(limit, 100)));
}

export async function runLabIngestion(provider: LabProvider, options?: { triggerType?: string; maxItems?: number; refreshHours?: number }): Promise<LabIngestionSummary> {
  const db = ensureSchema();
  const runId = `labrun-${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  const triggerType = options?.triggerType || 'manual';
  const maxItems = Math.max(1, Math.min(options?.maxItems || 500, 5000));
  const refreshHours = Math.max(0, options?.refreshHours ?? 24);
  db.prepare(`INSERT INTO cannabis_lab_ingestion_runs (id,provider,trigger_type,status,started_at) VALUES (?,?,?,?,?)`).run(runId, provider.id, triggerType, 'running', startedAt);

  const summary: LabIngestionSummary = { runId, provider: provider.id, discovered: 0, imported: 0, unchanged: 0, failed: 0, errors: [] };
  try {
    const discovered = (await provider.discover({ maxItems })).slice(0, maxItems);
    summary.discovered = discovered.length;
    const now = new Date().toISOString();
    const cutoffMs = Date.now() - refreshHours * 60 * 60 * 1000;

    for (const item of discovered) {
      db.prepare(`INSERT INTO cannabis_lab_ingestion_items (id,provider,external_id,source_url,status,first_seen_at,last_seen_at)
                  VALUES (?,?,?,?, 'discovered',?,?)
                  ON CONFLICT(provider,external_id) DO UPDATE SET source_url=excluded.source_url,last_seen_at=excluded.last_seen_at`)
        .run(`labi-${crypto.randomUUID()}`, provider.id, item.externalId, item.sourceUrl, now, now);

      const state = db.prepare(`SELECT * FROM cannabis_lab_ingestion_items WHERE provider=? AND external_id=? LIMIT 1`).get(provider.id, item.externalId) as any;
      if (state?.last_checked_at && refreshHours > 0 && Date.parse(state.last_checked_at) > cutoffMs) {
        summary.unchanged++;
        continue;
      }

      try {
        const normalized = await provider.fetchAndNormalize(item);
        const fingerprint = provider.fingerprint(normalized);
        const checkedAt = new Date().toISOString();
        if (state?.fingerprint && state.fingerprint === fingerprint) {
          db.prepare(`UPDATE cannabis_lab_ingestion_items SET status='unchanged',last_error=NULL,last_checked_at=?,last_seen_at=? WHERE provider=? AND external_id=?`)
            .run(checkedAt, checkedAt, provider.id, item.externalId);
          summary.unchanged++;
          continue;
        }
        const imported = provider.ingest(normalized);
        db.prepare(`UPDATE cannabis_lab_ingestion_items SET fingerprint=?,product_id=?,batch_id=?,status='imported',last_error=NULL,last_checked_at=?,last_imported_at=?,last_seen_at=? WHERE provider=? AND external_id=?`)
          .run(fingerprint, imported.productId, imported.batchId, checkedAt, checkedAt, checkedAt, provider.id, item.externalId);
        summary.imported++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown ingestion error';
        const checkedAt = new Date().toISOString();
        db.prepare(`UPDATE cannabis_lab_ingestion_items SET status='failed',last_error=?,last_checked_at=?,last_seen_at=? WHERE provider=? AND external_id=?`)
          .run(message.slice(0, 2000), checkedAt, checkedAt, provider.id, item.externalId);
        summary.failed++;
        if (summary.errors.length < 25) summary.errors.push({ sourceUrl: item.sourceUrl, error: message });
      }
    }

    db.prepare(`UPDATE cannabis_lab_ingestion_runs SET status='completed',discovered_count=?,imported_count=?,unchanged_count=?,failed_count=?,finished_at=? WHERE id=?`)
      .run(summary.discovered, summary.imported, summary.unchanged, summary.failed, new Date().toISOString(), runId);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lab ingestion failed';
    db.prepare(`UPDATE cannabis_lab_ingestion_runs SET status='failed',discovered_count=?,imported_count=?,unchanged_count=?,failed_count=?,finished_at=?,error=? WHERE id=?`)
      .run(summary.discovered, summary.imported, summary.unchanged, summary.failed, new Date().toISOString(), message.slice(0, 2000), runId);
    throw error;
  }
}
