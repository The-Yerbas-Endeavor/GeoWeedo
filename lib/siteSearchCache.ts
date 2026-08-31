import 'server-only';

import { createHash } from 'node:crypto';
import { getDatabase } from '@/lib/sqlite';
import type { SiteSearchProvider, SiteSearchResult } from '@/lib/siteSearchProvider';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function ttlMs() {
  const raw = Number(process.env.SITE_SEARCH_CACHE_TTL_MS || DEFAULT_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

function cacheKey(provider: SiteSearchProvider, query: string) {
  return createHash('sha256').update(`${provider}\n${query.trim().toLowerCase()}`).digest('hex');
}

function ensureTable() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_search_cache (
      query_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      query TEXT NOT NULL,
      results_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS site_search_cache_expiry_idx ON site_search_cache(expires_at);
  `);
  return db;
}

export function getCachedSiteSearch(provider: SiteSearchProvider, query: string): SiteSearchResult[] | null {
  const db = ensureTable();
  const now = new Date().toISOString();
  const key = cacheKey(provider, query);
  const row = db.prepare(`
    SELECT results_json
    FROM site_search_cache
    WHERE query_key = ? AND expires_at > ?
  `).get(key, now) as { results_json?: string } | undefined;

  if (!row?.results_json) return null;
  try {
    const parsed = JSON.parse(row.results_json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    db.prepare(`DELETE FROM site_search_cache WHERE query_key = ?`).run(key);
    return null;
  }
}

export function setCachedSiteSearch(provider: SiteSearchProvider, query: string, results: SiteSearchResult[]) {
  const db = ensureTable();
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + ttlMs());
  const key = cacheKey(provider, query);

  db.prepare(`
    INSERT INTO site_search_cache(query_key, provider, query, results_json, fetched_at, expires_at)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(query_key) DO UPDATE SET
      provider = excluded.provider,
      query = excluded.query,
      results_json = excluded.results_json,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at
  `).run(
    key,
    provider,
    query,
    JSON.stringify(results),
    fetchedAt.toISOString(),
    expiresAt.toISOString(),
  );

  db.prepare(`DELETE FROM site_search_cache WHERE expires_at <= ?`).run(fetchedAt.toISOString());
}
