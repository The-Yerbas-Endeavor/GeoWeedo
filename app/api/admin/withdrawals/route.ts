import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { yerbasRpc } from '@/lib/yerbasRpc';

export const runtime = 'nodejs';
const ATOMIC = 100_000_000;

type ValidateAddressResult = { isvalid?: boolean };
type WalletTx = { fee?: number };

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const rows = getDatabase().prepare(`SELECT w.id, w.destination_address, w.amount_atomic, w.fee_atomic, w.status, w.requested_at, w.reviewed_at, w.sent_at, w.txid, w.failure_reason,
                                             u.username, u.display_name, u.yerbas_address
                                      FROM withdrawals w JOIN wallets wal ON wal.id = w.wallet_id JOIN users u ON u.id = wal.user_id
                                      ORDER BY w.requested_at DESC LIMIT 200`).all();
  const rpcConfigured = Boolean(process.env.YERB_RPC_URL && process.env.YERB_RPC_USER && process.env.YERB_RPC_PASSWORD);
  return NextResponse.json({ withdrawals: rows, rpcConfigured });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = String(body?.id || '');
  const action = String(body?.action || '');
  if (!id || !['approve', 'reject', 'send'].includes(action)) {
    return NextResponse.json({ error: 'Valid withdrawal id and action are required.' }, { status: 400 });
  }

  const db = getDatabase();
  const withdrawal = db.prepare(`SELECT id, wallet_id, destination_address, amount_atomic, fee_atomic, status, hold_ledger_id, txid
                                 FROM withdrawals WHERE id = ?`).get(id) as any;
  if (!withdrawal) return NextResponse.json({ error: 'Withdrawal not found.' }, { status: 404 });
  const now = new Date().toISOString();

  if (action === 'send') {
    if (withdrawal.status === 'sent' || withdrawal.status === 'completed') {
      return NextResponse.json({ ok: true, id, status: withdrawal.status, txid: withdrawal.txid });
    }
    if (withdrawal.status !== 'approved') {
      return NextResponse.json({ error: 'Withdrawal must be approved before it can be sent.' }, { status: 409 });
    }
    if (!(process.env.YERB_RPC_URL && process.env.YERB_RPC_USER && process.env.YERB_RPC_PASSWORD)) {
      return NextResponse.json({ error: 'Yerbas RPC is not configured.' }, { status: 503 });
    }

    const destination = String(withdrawal.destination_address || '').trim();
    const amountAtomic = Number(withdrawal.amount_atomic || 0);
    const amountYerb = amountAtomic / ATOMIC;
    if (!destination || !Number.isSafeInteger(amountAtomic) || amountAtomic <= 0) {
      return NextResponse.json({ error: 'Withdrawal record is invalid.' }, { status: 400 });
    }

    try {
      try {
        const validation = await yerbasRpc<ValidateAddressResult>('validateaddress', [destination]);
        if (validation && validation.isvalid === false) {
          return NextResponse.json({ error: 'Yerbas Core rejected the destination address.' }, { status: 400 });
        }
      } catch {
        // Some compatible wallets do not expose validateaddress; sendtoaddress remains authoritative.
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        const changed = db.prepare("UPDATE withdrawals SET status = 'processing', failure_reason = NULL WHERE id = ? AND status = 'approved'").run(id) as any;
        if (!Number(changed?.changes || 0)) throw new Error('Withdrawal is no longer approved.');
        db.prepare(`INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, created_at)
                    VALUES (?, 'admin', ?, 'withdrawal.send_started', 'withdrawal', ?, ?)`)
          .run(`audit-${crypto.randomUUID()}`, admin.id, id, now);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      let txid = '';
      try {
        txid = String(await yerbasRpc<string>('sendtoaddress', [destination, amountYerb])).trim();
        if (!txid) throw new Error('Yerbas Core returned an empty transaction id.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Yerbas send failed.';
        db.prepare("UPDATE withdrawals SET status = 'approved', failure_reason = ? WHERE id = ? AND status = 'processing'").run(message.slice(0, 500), id);
        db.prepare(`INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
                    VALUES (?, 'admin', ?, 'withdrawal.send_failed', 'withdrawal', ?, ?, ?)`)
          .run(`audit-${crypto.randomUUID()}`, admin.id, id, JSON.stringify({ error: message }), new Date().toISOString());
        return NextResponse.json({ error: message }, { status: 502 });
      }

      let feeAtomic = 0;
      try {
        const walletTx = await yerbasRpc<WalletTx>('gettransaction', [txid]);
        const fee = Math.abs(Number(walletTx?.fee || 0));
        if (Number.isFinite(fee)) feeAtomic = Math.round(fee * ATOMIC);
      } catch {
        feeAtomic = 0;
      }

      const sentAt = new Date().toISOString();
      const debitId = `ledger-${crypto.randomUUID()}`;
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = db.prepare('SELECT status, hold_ledger_id, debit_ledger_id FROM withdrawals WHERE id = ?').get(id) as any;
        if (!current || current.status !== 'processing') throw new Error('Withdrawal state changed while sending.');

        if (!current.debit_ledger_id) {
          db.prepare(`INSERT INTO wallet_ledger
                      (id, wallet_id, entry_type, amount_atomic, status, reference_type, reference_id, txid, memo, created_at, posted_at)
                      VALUES (?, ?, 'withdrawal_debit', ?, 'posted', 'withdrawal', ?, ?, ?, ?, ?)`)
            .run(debitId, withdrawal.wallet_id, -amountAtomic, id, txid, `YERB withdrawal to ${destination}`, sentAt, sentAt);
        }
        if (current.hold_ledger_id) {
          db.prepare("UPDATE wallet_ledger SET status = 'released', posted_at = ? WHERE id = ? AND status = 'held'")
            .run(sentAt, current.hold_ledger_id);
        }
        db.prepare(`UPDATE withdrawals
                    SET status = 'sent', txid = ?, fee_atomic = ?, sent_at = ?, debit_ledger_id = COALESCE(debit_ledger_id, ?), failure_reason = NULL
                    WHERE id = ?`)
          .run(txid, feeAtomic, sentAt, debitId, id);
        db.prepare(`INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
                    VALUES (?, 'admin', ?, 'withdrawal.sent', 'withdrawal', ?, ?, ?)`)
          .run(`audit-${crypto.randomUUID()}`, admin.id, id, JSON.stringify({ txid, amountYerb, destination, feeAtomic }), sentAt);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      return NextResponse.json({ ok: true, id, status: 'sent', txid, amountYerb, feeYerb: feeAtomic / ATOMIC });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not send withdrawal.' }, { status: 500 });
    }
  }

  if (withdrawal.status !== 'requested') {
    return NextResponse.json({ error: 'Withdrawal is not awaiting review.' }, { status: 409 });
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    if (action === 'approve') {
      db.prepare("UPDATE withdrawals SET status = 'approved', reviewed_by_admin_id = ?, reviewed_at = ? WHERE id = ?").run(admin.id, now, id);
    } else {
      db.prepare("UPDATE withdrawals SET status = 'rejected', reviewed_by_admin_id = ?, reviewed_at = ?, failure_reason = 'Rejected by administrator' WHERE id = ?").run(admin.id, now, id);
      if (withdrawal.hold_ledger_id) db.prepare("UPDATE wallet_ledger SET status = 'released', posted_at = ? WHERE id = ? AND status = 'held'").run(now, withdrawal.hold_ledger_id);
    }
    db.prepare(`INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, created_at)
                VALUES (?, 'admin', ?, ?, 'withdrawal', ?, ?)`)
      .run(`audit-${crypto.randomUUID()}`, admin.id, `withdrawal.${action}`, id, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return NextResponse.json({ ok: true, id, status: action === 'approve' ? 'approved' : 'rejected' });
}
