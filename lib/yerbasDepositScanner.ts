import 'server-only';

import crypto from 'crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '@/lib/sqlite';
import { yerbasRpc } from '@/lib/yerbasRpc';

const ATOMIC = 100_000_000;
const TREASURY_KEY = 'yerb_treasury_address';
const LAST_SCAN_KEY = 'yerb_deposit_scan_last_at';
const DEFAULT_CONFIRMATIONS = 6;

type WalletTransaction = {
  account?: string;
  address?: string;
  category?: string;
  amount?: number;
  confirmations?: number;
  txid?: string;
  vout?: number;
  blockhash?: string;
  blockindex?: number;
  blocktime?: number;
  time?: number;
  timereceived?: number;
};

export type DepositScanResult = {
  scanned: number;
  incoming: number;
  playerDeposits: number;
  treasuryDeposits: number;
  newlyDetected: number;
  newlyCredited: number;
  updated: number;
  ignored: number;
  confirmationThreshold: number;
  scannedAt: string;
};

export function depositConfirmationThreshold() {
  const parsed = Number(process.env.YERB_DEPOSIT_CONFIRMATIONS || DEFAULT_CONFIRMATIONS);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_CONFIRMATIONS;
}

export function ensureDepositScanSchema(db: DatabaseSync = getDatabase()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS treasury_deposits (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      txid TEXT NOT NULL,
      vout INTEGER NOT NULL DEFAULT 0,
      amount_atomic INTEGER NOT NULL,
      confirmations INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      block_hash TEXT,
      detected_at TEXT NOT NULL,
      confirmed_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(txid, vout)
    );
    CREATE INDEX IF NOT EXISTS treasury_deposits_status_idx
      ON treasury_deposits(status, detected_at DESC);
  `);
}

function readSettingString(key: string, db: DatabaseSync) {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as
    | { value_json?: string }
    | undefined;
  if (!row?.value_json) return null;
  try {
    const value = JSON.parse(row.value_json);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function writeSettingString(key: string, value: string, db: DatabaseSync) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value_json, public, updated_by_admin_id, updated_at)
    VALUES (?, ?, 0, NULL, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), now);
}

export function getDepositScanStatus(db: DatabaseSync = getDatabase()) {
  ensureDepositScanSchema(db);
  return {
    lastScanAt: readSettingString(LAST_SCAN_KEY, db),
    confirmationThreshold: depositConfirmationThreshold(),
  };
}

function transactionDetectedAt(tx: WalletTransaction, fallback: string) {
  const timestamp = Number(tx.timereceived || tx.time || tx.blocktime || 0);
  return timestamp > 0 ? new Date(timestamp * 1000).toISOString() : fallback;
}

function classifyStatus(confirmations: number, threshold: number) {
  if (confirmations < 0) return 'conflicted';
  if (confirmations >= threshold) return 'confirmed';
  return 'pending';
}

export async function scanYerbasDeposits(db: DatabaseSync = getDatabase()): Promise<DepositScanResult> {
  ensureDepositScanSchema(db);
  const threshold = depositConfirmationThreshold();
  const now = new Date().toISOString();
  const treasuryAddress = String(process.env.YERB_TREASURY_ADDRESS || '').trim() || readSettingString(TREASURY_KEY, db) || '';

  const addressRows = db.prepare(`
    SELECT address, wallet_id
    FROM wallet_addresses
    WHERE active = 1 AND address_type = 'deposit'
  `).all() as Array<{ address: string; wallet_id: string }>;
  const playerAddresses = new Map(addressRows.map((row) => [String(row.address), String(row.wallet_id)]));

  const transactions = await yerbasRpc<WalletTransaction[]>('listtransactions', ['*', 1000, 0]);
  const result: DepositScanResult = {
    scanned: Array.isArray(transactions) ? transactions.length : 0,
    incoming: 0,
    playerDeposits: 0,
    treasuryDeposits: 0,
    newlyDetected: 0,
    newlyCredited: 0,
    updated: 0,
    ignored: 0,
    confirmationThreshold: threshold,
    scannedAt: now,
  };

  for (const tx of Array.isArray(transactions) ? transactions : []) {
    const category = String(tx.category || '').toLowerCase();
    const address = String(tx.address || '').trim();
    const txid = String(tx.txid || '').trim();
    const amount = Number(tx.amount || 0);
    const vout = Number.isInteger(Number(tx.vout)) ? Number(tx.vout) : 0;
    const confirmations = Number.isFinite(Number(tx.confirmations)) ? Number(tx.confirmations) : 0;

    if (category !== 'receive' || !address || !txid || !Number.isFinite(amount) || amount <= 0) {
      result.ignored += 1;
      continue;
    }

    result.incoming += 1;
    const amountAtomic = Math.round(amount * ATOMIC);
    const detectedAt = transactionDetectedAt(tx, now);
    const incomingStatus = classifyStatus(confirmations, threshold);
    const walletId = playerAddresses.get(address);

    if (walletId) {
      result.playerDeposits += 1;
      const existing = db.prepare('SELECT id, status, credited_ledger_id FROM deposits WHERE txid = ? AND vout = ?').get(txid, vout) as any;
      const depositId = existing?.id || `deposit-${crypto.randomUUID()}`;

      if (!existing) {
        db.prepare(`
          INSERT INTO deposits
            (id, wallet_id, address, txid, vout, amount_atomic, block_height, confirmations, status, detected_at, confirmed_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
        `).run(
          depositId,
          walletId,
          address,
          txid,
          vout,
          amountAtomic,
          confirmations,
          incomingStatus,
          detectedAt,
          incomingStatus === 'confirmed' ? now : null,
        );
        result.newlyDetected += 1;
      } else if (existing.status !== 'credited') {
        db.prepare(`
          UPDATE deposits
          SET wallet_id = ?, address = ?, amount_atomic = ?, confirmations = ?, status = ?,
              confirmed_at = CASE WHEN ? = 'confirmed' THEN COALESCE(confirmed_at, ?) ELSE confirmed_at END
          WHERE id = ?
        `).run(walletId, address, amountAtomic, confirmations, incomingStatus, incomingStatus, now, depositId);
        result.updated += 1;
      } else {
        db.prepare('UPDATE deposits SET confirmations = ? WHERE id = ?').run(confirmations, depositId);
        result.updated += 1;
      }

      if (confirmations >= threshold) {
        const current = db.prepare('SELECT status, credited_ledger_id FROM deposits WHERE id = ?').get(depositId) as any;
        if (!current?.credited_ledger_id) {
          const duplicateLedger = db.prepare(`
            SELECT id FROM wallet_ledger
            WHERE reference_type = 'deposit' AND reference_id = ?
            LIMIT 1
          `).get(depositId) as { id?: string } | undefined;
          const ledgerId = duplicateLedger?.id || `ledger-${crypto.randomUUID()}`;

          db.exec('BEGIN IMMEDIATE');
          try {
            if (!duplicateLedger?.id) {
              db.prepare(`
                INSERT INTO wallet_ledger
                  (id, wallet_id, entry_type, amount_atomic, status, reference_type, reference_id,
                   txid, confirmations, memo, created_at, posted_at)
                VALUES (?, ?, 'deposit_credit', ?, 'posted', 'deposit', ?, ?, ?, ?, ?, ?)
              `).run(
                ledgerId,
                walletId,
                amountAtomic,
                depositId,
                txid,
                confirmations,
                `Yerbas deposit ${txid}`,
                now,
                now,
              );
            }
            db.prepare(`
              UPDATE deposits
              SET status = 'credited', confirmations = ?, credited_ledger_id = ?, confirmed_at = COALESCE(confirmed_at, ?)
              WHERE id = ?
            `).run(confirmations, ledgerId, now, depositId);
            db.exec('COMMIT');
            if (!duplicateLedger?.id) result.newlyCredited += 1;
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        }
      }
      continue;
    }

    if (treasuryAddress && address === treasuryAddress) {
      result.treasuryDeposits += 1;
      const existing = db.prepare('SELECT id, status FROM treasury_deposits WHERE txid = ? AND vout = ?').get(txid, vout) as any;
      const id = existing?.id || `treasury-deposit-${crypto.randomUUID()}`;
      const status = classifyStatus(confirmations, threshold);
      if (!existing) {
        db.prepare(`
          INSERT INTO treasury_deposits
            (id, address, txid, vout, amount_atomic, confirmations, status, block_hash,
             detected_at, confirmed_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          address,
          txid,
          vout,
          amountAtomic,
          confirmations,
          status,
          tx.blockhash || null,
          detectedAt,
          status === 'confirmed' ? now : null,
          now,
        );
        result.newlyDetected += 1;
      } else {
        db.prepare(`
          UPDATE treasury_deposits
          SET amount_atomic = ?, confirmations = ?, status = ?, block_hash = ?,
              confirmed_at = CASE WHEN ? = 'confirmed' THEN COALESCE(confirmed_at, ?) ELSE confirmed_at END,
              updated_at = ?
          WHERE id = ?
        `).run(
          amountAtomic,
          confirmations,
          status,
          tx.blockhash || null,
          status,
          now,
          now,
          id,
        );
        result.updated += 1;
      }
      continue;
    }

    result.ignored += 1;
  }

  writeSettingString(LAST_SCAN_KEY, now, db);
  return result;
}
