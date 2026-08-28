import 'server-only';

import crypto from 'crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '@/lib/sqlite';

export function ensureFinanceSchema(db: DatabaseSync = getDatabase()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_accounts (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'YERB',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_ledger (
      id TEXT PRIMARY KEY,
      system_account_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      amount_atomic INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'posted',
      reference_type TEXT,
      reference_id TEXT,
      txid TEXT,
      memo TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      posted_at TEXT,
      FOREIGN KEY(system_account_id) REFERENCES system_accounts(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS system_ledger_account_idx ON system_ledger(system_account_id, status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS system_ledger_reference_unique ON system_ledger(reference_type, reference_id)
      WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS system_ledger_txid_income_unique ON system_ledger(txid, entry_type)
      WHERE txid IS NOT NULL;
  `);

  const now = new Date().toISOString();
  const defaults = [
    ['sys-rewards', 'rewards_pool', 'GeoWeedo Rewards Pool', 'expense'],
    ['sys-sponsorship', 'sponsorship_income', 'Sponsorship Income', 'income'],
    ['sys-custody', 'yerb_custody', 'YERB Custody / Hot Wallet', 'asset'],
    ['sys-fees', 'network_fees', 'YERB Network Fees', 'expense'],
  ];
  const insert = db.prepare(`INSERT OR IGNORE INTO system_accounts (id, code, name, account_type, currency, active, created_at, updated_at)
                             VALUES (?, ?, ?, ?, 'YERB', 1, ?, ?)`);
  for (const [id, code, name, type] of defaults) insert.run(id, code, name, type, now, now);
}

export function getSystemAccountId(code: string, db: DatabaseSync = getDatabase()) {
  ensureFinanceSchema(db);
  const row = db.prepare('SELECT id FROM system_accounts WHERE code = ? AND active = 1').get(code) as any;
  if (!row) throw new Error(`System account not found: ${code}`);
  return String(row.id);
}

export function postSystemLedgerEntry(input: {
  accountCode: string;
  entryType: string;
  amountAtomic: number;
  referenceType?: string;
  referenceId?: string;
  txid?: string;
  memo?: string;
  metadata?: unknown;
}, db: DatabaseSync = getDatabase()) {
  ensureFinanceSchema(db);
  const accountId = getSystemAccountId(input.accountCode, db);
  const id = `sysledger-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO system_ledger (id, system_account_id, entry_type, amount_atomic, status, reference_type, reference_id, txid, memo, metadata_json, created_at, posted_at)
              VALUES (?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, accountId, input.entryType, input.amountAtomic, input.referenceType || null, input.referenceId || null, input.txid || null, input.memo || null, input.metadata === undefined ? null : JSON.stringify(input.metadata), now, now);
  return id;
}
