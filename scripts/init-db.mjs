import { getDatabase, getDatabasePath } from '../lib/sqlite.ts';

const db = getDatabase();
const now = new Date().toISOString();

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

const defaults = [
  ['sys-rewards', 'rewards_pool', 'GeoWeedo Rewards Pool', 'expense'],
  ['sys-sponsorship', 'sponsorship_income', 'Sponsorship Income', 'income'],
  ['sys-custody', 'yerb_custody', 'YERB Custody / Hot Wallet', 'asset'],
  ['sys-fees', 'network_fees', 'YERB Network Fees', 'expense'],
];
const insert = db.prepare(`INSERT OR IGNORE INTO system_accounts (id, code, name, account_type, currency, active, created_at, updated_at)
                           VALUES (?, ?, ?, ?, 'YERB', 1, ?, ?)`);
for (const [id, code, name, type] of defaults) insert.run(id, code, name, type, now, now);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const migration = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1').get();

console.log(`GeoWeedo SQLite initialized: ${getDatabasePath()}`);
console.log(`Tables: ${tables.length}`);
if (migration) console.log(`Schema: v${migration.version} ${migration.name}`);
