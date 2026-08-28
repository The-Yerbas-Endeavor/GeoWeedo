import crypto from 'crypto';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = path.join(process.cwd(), 'data', 'runtime', 'geoweedo.sqlite');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const rpcUrl = process.env.YERB_RPC_URL;
const rpcUser = process.env.YERB_RPC_USER;
const rpcPassword = process.env.YERB_RPC_PASSWORD;
const confirmationsRequired = Number(process.env.YERB_DEPOSIT_CONFIRMATIONS || 6);
const withdrawalsEnabled = String(process.env.YERB_WITHDRAWALS_ENABLED || 'false').toLowerCase() === 'true';
const ATOMIC = 100_000_000;

if (!rpcUrl || !rpcUser || !rpcPassword) throw new Error('YERB_RPC_URL, YERB_RPC_USER and YERB_RPC_PASSWORD are required.');

async function rpc(method, params = []) {
  const auth = Buffer.from(`${rpcUser}:${rpcPassword}`).toString('base64');
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'geoweedo-wallet-worker', method, params }),
  });
  if (!response.ok) throw new Error(`Yerbas RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || `Yerbas RPC error ${payload.error.code}`);
  return payload.result;
}

function atomicFromYerb(value) {
  return Math.round(Number(value) * ATOMIC);
}

async function scanDeposits() {
  const transactions = await rpc('listtransactions', ['*', 1000, 0, true]);
  let credited = 0;
  for (const tx of Array.isArray(transactions) ? transactions : []) {
    if (tx.category !== 'receive' || !tx.address || !tx.txid) continue;
    const addressRow = db.prepare("SELECT wallet_id FROM wallet_addresses WHERE address = ? AND address_type = 'deposit' AND active = 1").get(String(tx.address));
    if (!addressRow) continue;

    const vout = Number.isInteger(tx.vout) ? tx.vout : 0;
    const amountAtomic = atomicFromYerb(tx.amount);
    const confirmations = Math.max(0, Number(tx.confirmations || 0));
    const now = new Date().toISOString();
    const status = confirmations >= confirmationsRequired ? 'confirmed' : 'detected';
    let deposit = db.prepare('SELECT id, credited_ledger_id FROM deposits WHERE txid = ? AND vout = ?').get(tx.txid, vout);

    if (!deposit) {
      const id = `dep-${crypto.randomUUID()}`;
      db.prepare(`INSERT INTO deposits (id, wallet_id, address, txid, vout, amount_atomic, block_height, confirmations, status, detected_at, confirmed_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, addressRow.wallet_id, tx.address, tx.txid, vout, amountAtomic, tx.blockheight ?? null, confirmations, status, now, status === 'confirmed' ? now : null);
      deposit = { id, credited_ledger_id: null };
    } else {
      db.prepare('UPDATE deposits SET confirmations = ?, block_height = COALESCE(?, block_height), status = ?, confirmed_at = CASE WHEN ? = \'confirmed\' THEN COALESCE(confirmed_at, ?) ELSE confirmed_at END WHERE id = ?')
        .run(confirmations, tx.blockheight ?? null, status, status, now, deposit.id);
    }

    if (status === 'confirmed' && !deposit.credited_ledger_id) {
      const ledgerId = `ledger-${crypto.randomUUID()}`;
      db.exec('BEGIN IMMEDIATE');
      try {
        const fresh = db.prepare('SELECT credited_ledger_id FROM deposits WHERE id = ?').get(deposit.id);
        if (!fresh?.credited_ledger_id) {
          db.prepare(`INSERT INTO wallet_ledger (id, wallet_id, entry_type, amount_atomic, status, reference_type, reference_id, txid, block_height, confirmations, memo, created_at, posted_at)
                      VALUES (?, ?, 'deposit_credit', ?, 'posted', 'deposit', ?, ?, ?, ?, 'Confirmed YERB deposit', ?, ?)`)
            .run(ledgerId, addressRow.wallet_id, amountAtomic, deposit.id, tx.txid, tx.blockheight ?? null, confirmations, now, now);
          db.prepare('UPDATE deposits SET credited_ledger_id = ?, status = \'credited\', confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ?').run(ledgerId, now, deposit.id);
          credited++;
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  }
  console.log(`Deposit scan complete. Newly credited: ${credited}`);
}

async function processWithdrawals() {
  const pending = db.prepare("SELECT id, wallet_id, destination_address, amount_atomic, hold_ledger_id FROM withdrawals WHERE status = 'approved' ORDER BY reviewed_at LIMIT 25").all();
  if (!withdrawalsEnabled) {
    console.log(`Withdrawals disabled. Approved queue: ${pending.length}`);
    return;
  }

  for (const withdrawal of pending) {
    const amountYerb = Number(withdrawal.amount_atomic) / ATOMIC;
    try {
      db.prepare("UPDATE withdrawals SET status = 'sending' WHERE id = ? AND status = 'approved'").run(withdrawal.id);
      const txid = String(await rpc('sendtoaddress', [withdrawal.destination_address, amountYerb, `GeoWeedo withdrawal ${withdrawal.id}`]));
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("UPDATE withdrawals SET status = 'sent', txid = ?, sent_at = ? WHERE id = ?").run(txid, now, withdrawal.id);
        if (withdrawal.hold_ledger_id) {
          db.prepare("UPDATE wallet_ledger SET entry_type = 'withdrawal_debit', status = 'posted', txid = ?, posted_at = ?, memo = 'Sent YERB withdrawal' WHERE id = ? AND status = 'held'")
            .run(txid, now, withdrawal.hold_ledger_id);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      console.log(`Sent withdrawal ${withdrawal.id}: ${txid}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("UPDATE withdrawals SET status = 'failed', failure_reason = ? WHERE id = ?").run(message.slice(0, 500), withdrawal.id);
        if (withdrawal.hold_ledger_id) db.prepare("UPDATE wallet_ledger SET status = 'released', posted_at = ? WHERE id = ? AND status = 'held'").run(now, withdrawal.hold_ledger_id);
        db.exec('COMMIT');
      } catch {
        db.exec('ROLLBACK');
      }
      console.error(`Withdrawal ${withdrawal.id} failed: ${message}`);
    }
  }
}

await scanDeposits();
await processWithdrawals();
