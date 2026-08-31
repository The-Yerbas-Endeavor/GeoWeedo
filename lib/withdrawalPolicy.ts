import 'server-only';

import type { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '@/lib/sqlite';

const AUTO_WITHDRAW_LIMIT_KEY = 'yerb_auto_withdraw_limit_yerb';
const DEFAULT_AUTO_WITHDRAW_LIMIT_YERB = 100;
const MAX_AUTO_WITHDRAW_LIMIT_YERB = 1000000;

export function getAutoWithdrawLimitYerb(db: DatabaseSync = getDatabase()) {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(AUTO_WITHDRAW_LIMIT_KEY) as
    | { value_json?: string }
    | undefined;
  if (!row?.value_json) return DEFAULT_AUTO_WITHDRAW_LIMIT_YERB;
  try {
    const value = Number(JSON.parse(row.value_json));
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_AUTO_WITHDRAW_LIMIT_YERB;
  } catch {
    return DEFAULT_AUTO_WITHDRAW_LIMIT_YERB;
  }
}

export function setAutoWithdrawLimitYerb(value: number, adminId: string, db: DatabaseSync = getDatabase()) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_AUTO_WITHDRAW_LIMIT_YERB) {
    throw new Error(`Auto-withdraw limit must be between 0 and ${MAX_AUTO_WITHDRAW_LIMIT_YERB.toLocaleString()} YERB.`);
  }
  const normalized = Math.round(value * 100000000) / 100000000;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value_json, public, updated_by_admin_id, updated_at)
    VALUES (?, ?, 0, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      public = 0,
      updated_by_admin_id = excluded.updated_by_admin_id,
      updated_at = excluded.updated_at
  `).run(AUTO_WITHDRAW_LIMIT_KEY, JSON.stringify(normalized), adminId, now);
  return normalized;
}
