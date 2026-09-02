import 'server-only';
import { getDatabase } from '@/lib/sqlite';

export type ImageryProvider = 'google' | 'kartaview' | 'auto';

const PROVIDER_KEY = 'street_imagery_provider';
const WARNING_KEY = 'google_street_view_daily_warning';

function normalizeProvider(value: unknown): ImageryProvider | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'google' || normalized === 'kartaview' || normalized === 'auto' ? normalized : null;
}

function ensureUsageTable() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS imagery_provider_usage (
      usage_date TEXT NOT NULL,
      provider TEXT NOT NULL,
      request_type TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (usage_date, provider, request_type)
    );
  `);
  return db;
}

export function getConfiguredImageryProvider(): ImageryProvider {
  const db = getDatabase();
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(PROVIDER_KEY) as { value_json?: string } | undefined;
  if (row?.value_json) {
    try {
      const saved = normalizeProvider(JSON.parse(row.value_json));
      if (saved) return saved;
    } catch {}
  }
  return normalizeProvider(process.env.STREET_IMAGERY_PROVIDER) || 'kartaview';
}

export function setConfiguredImageryProvider(provider: ImageryProvider, adminId?: string | null) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value_json, public, updated_by_admin_id, updated_at)
    VALUES (?, ?, 0, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by_admin_id=excluded.updated_by_admin_id, updated_at=excluded.updated_at
  `).run(PROVIDER_KEY, JSON.stringify(provider), adminId || null, now);
}

export function getGoogleDailyWarningLimit() {
  const db = getDatabase();
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(WARNING_KEY) as { value_json?: string } | undefined;
  if (row?.value_json) {
    try {
      const value = Number(JSON.parse(row.value_json));
      if (Number.isFinite(value) && value >= 0) return Math.floor(value);
    } catch {}
  }
  const envValue = Number(process.env.GOOGLE_STREET_VIEW_DAILY_WARNING || 500);
  return Number.isFinite(envValue) && envValue >= 0 ? Math.floor(envValue) : 500;
}

export function setGoogleDailyWarningLimit(limit: number, adminId?: string | null) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const normalized = Math.max(0, Math.floor(limit));
  db.prepare(`
    INSERT INTO app_settings (key, value_json, public, updated_by_admin_id, updated_at)
    VALUES (?, ?, 0, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by_admin_id=excluded.updated_by_admin_id, updated_at=excluded.updated_at
  `).run(WARNING_KEY, JSON.stringify(normalized), adminId || null, now);
}

export function incrementImageryProviderUsage(provider: 'google' | 'kartaview', requestType: string) {
  const db = ensureUsageTable();
  const date = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO imagery_provider_usage (usage_date, provider, request_type, request_count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(usage_date, provider, request_type)
    DO UPDATE SET request_count=request_count+1, updated_at=excluded.updated_at
  `).run(date, provider, requestType, now);
}

export function getImageryProviderUsage(days = 7) {
  const db = ensureUsageTable();
  const safeDays = Math.min(90, Math.max(1, Math.floor(days)));
  const rows = db.prepare(`
    SELECT usage_date, provider, request_type, request_count
    FROM imagery_provider_usage
    WHERE usage_date >= date('now', ?)
    ORDER BY usage_date DESC, provider, request_type
  `).all(`-${safeDays - 1} days`) as Array<{usage_date:string;provider:string;request_type:string;request_count:number}>;
  const today = new Date().toISOString().slice(0, 10);
  const googleToday = rows.filter(row => row.usage_date === today && row.provider === 'google').reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  const googleImagesToday = rows.filter(row => row.usage_date === today && row.provider === 'google' && row.request_type === 'image').reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  const googleMetadataToday = rows.filter(row => row.usage_date === today && row.provider === 'google' && row.request_type === 'metadata').reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  const googlePanoramasToday = rows.filter(row => row.usage_date === today && row.provider === 'google' && row.request_type === 'panorama').reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  return { rows, today, googleToday, googleImagesToday, googleMetadataToday, googlePanoramasToday };
}

export function getGooglePanoramaUsageForCurrentMonth() {
  const db = ensureUsageTable();
  const rows = db.prepare(`
    SELECT usage_date, request_count
    FROM imagery_provider_usage
    WHERE provider = 'google'
      AND request_type = 'panorama'
      AND usage_date >= date('now', 'start of month')
    ORDER BY usage_date ASC
  `).all() as Array<{usage_date:string;request_count:number}>;
  const total = rows.reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  return { rows, total };
}
