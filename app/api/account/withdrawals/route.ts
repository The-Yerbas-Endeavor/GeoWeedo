import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { getUserFromRequest } from '@/lib/userAuth';
import { yerbasRpc } from '@/lib/yerbasRpc';

export const runtime = 'nodejs';
const ATOMIC = 100_000_000;
const AUTO_WITHDRAW_LIMIT_YERB = 100;

type ValidateAddressResult = { isvalid?: boolean };
type WalletTx = { fee?: number };

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user || !user.walletId) return NextResponse.json({ error: 'Login required.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const destination = String(body?.destinationAddress || '').trim();
  const amountYerb = Number(body?.amountYerb);
  if (destination.length < 20 || destination.length > 80) {
    return NextResponse.json({ error: 'Enter a valid Yerbas destination address.' }, { status: 400 });
  }
  if (!Number.isFinite(amountYerb) || amountYerb <= 0) {
    return NextResponse.json({ error: 'Enter a valid withdrawal amount.' }, { status: 400 });
  }

  const amountAtomic = Math.round(amountYerb * ATOMIC);
  if (!Number.isSafeInteger(amountAtomic) || amountAtomic <= 0) {
    return NextResponse.json({ error: 'Withdrawal amount is outside the supported range.' }, { status: 400 });
  }

  const db = getDatabase();
  const now = new Date().toISOString();
  const withdrawalId = `wd-${crypto.randomUUID()}`;
  const holdId = `ledger-${crypto.randomUUID()}`;
  const autoSubmit = amountYerb < AUTO_WITHDRAW_LIMIT_YERB;

  db.exec('BEGIN IMMEDIATE');
  try {
    const posted = db.prepare("SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger WHERE wallet_id = ? AND status = 'posted'").get(user.walletId) as any;
    const heldDebits = db.prepare("SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger WHERE wallet_id = ? AND status = 'held' AND amount_atomic < 0").get(user.walletId) as any;
    const available = Math.max(0, Number(posted?.amount || 0) + Number(heldDebits?.amount || 0));
    if (amountAtomic > available) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: 'Insufficient available YERB balance.' }, { status: 400 });
    }

    db.prepare(`INSERT INTO wallet_ledger (id, wallet_id, entry_type, amount_atomic, status, reference_type, reference_id, memo, created_at)
                VALUES (?, ?, 'withdrawal_hold', ?, 'held', 'withdrawal', ?, ?, ?)`)
      .run(holdId, user.walletId, -amountAtomic, withdrawalId, `Withdrawal hold to ${destination}`, now);

    db.prepare(`INSERT INTO withdrawals
      (id, wallet_id, destination_address, amount_atomic, fee_atomic, status, requested_at, reviewed_at, hold_ledger_id)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`)
      .run(withdrawalId, user.walletId, destination, amountAtomic, autoSubmit ? 'approved' : 'requested', now, autoSubmit ? now : null, holdId);

    db.prepare(`INSERT INTO audit_log
      (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
      VALUES (?, 'user', ?, ?, 'withdrawal', ?, ?, ?)`)
      .run(
        `audit-${crypto.randomUUID()}`,
        user.id,
        autoSubmit ? 'withdrawal.auto_approved' : 'withdrawal.requested',
        withdrawalId,
        JSON.stringify({ amountYerb, destination, autoSubmit }),
        now,
      );

    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }

  if (!autoSubmit) {
    return NextResponse.json({
      id: withdrawalId,
      status: 'requested',
      amountYerb,
      destinationAddress: destination,
      autoSubmitted: false,
    }, { status: 201 });
  }

  if (!(process.env.YERB_RPC_URL && process.env.YERB_RPC_USER && process.env.YERB_RPC_PASSWORD)) {
    return NextResponse.json({
      id: withdrawalId,
      status: 'approved',
      amountYerb,
      destinationAddress: destination,
      autoSubmitted: false,
      warning: 'Withdrawal was auto-approved but Yerbas RPC is not configured; it is waiting to be sent.',
    }, { status: 201 });
  }

  try {
    try {
      const validation = await yerbasRpc<ValidateAddressResult>('validateaddress', [destination]);
      if (validation && validation.isvalid === false) {
        db.prepare("UPDATE withdrawals SET status = 'rejected', failure_reason = ?, reviewed_at = ? WHERE id = ?")
          .run('Yerbas Core rejected the destination address.', new Date().toISOString(), withdrawalId);
        db.prepare("UPDATE wallet_ledger SET status = 'released', posted_at = ? WHERE id = ? AND status = 'held'")
          .run(new Date().toISOString(), holdId);
        return NextResponse.json({ error: 'Yerbas Core rejected the destination address.' }, { status: 400 });
      }
    } catch {
      // Some compatible wallets do not expose validateaddress; sendtoaddress remains authoritative.
    }

    const processingAt = new Date().toISOString();
    const changed = db.prepare("UPDATE withdrawals SET status = 'processing', failure_reason = NULL WHERE id = ? AND status = 'approved'").run(withdrawalId) as any;
    if (!Number(changed?.changes || 0)) throw new Error('Withdrawal is no longer approved.');

    let txid = '';
    try {
      txid = String(await yerbasRpc<string>('sendtoaddress', [destination, amountYerb])).trim();
      if (!txid) throw new Error('Yerbas Core returned an empty transaction id.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Yerbas send failed.';
      db.prepare("UPDATE withdrawals SET status = 'approved', failure_reason = ? WHERE id = ? AND status = 'processing'")
        .run(message.slice(0, 500), withdrawalId);
      db.prepare(`INSERT INTO audit_log
        (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
        VALUES (?, 'user', ?, 'withdrawal.auto_send_failed', 'withdrawal', ?, ?, ?)`)
        .run(`audit-${crypto.randomUUID()}`, user.id, withdrawalId, JSON.stringify({ error: message }), new Date().toISOString());
      return NextResponse.json({
        id: withdrawalId,
        status: 'approved',
        amountYerb,
        destinationAddress: destination,
        autoSubmitted: false,
        warning: message,
      }, { status: 201 });
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
      db.prepare(`INSERT INTO wallet_ledger
        (id, wallet_id, entry_type, amount_atomic, status, reference_type, reference_id, txid, memo, created_at, posted_at)
        VALUES (?, ?, 'withdrawal_debit', ?, 'posted', 'withdrawal', ?, ?, ?, ?, ?)`)
        .run(debitId, user.walletId, -amountAtomic, withdrawalId, txid, `YERB withdrawal to ${destination}`, sentAt, sentAt);

      db.prepare("UPDATE wallet_ledger SET status = 'released', posted_at = ? WHERE id = ? AND status = 'held'")
        .run(sentAt, holdId);

      db.prepare(`UPDATE withdrawals
        SET status = 'sent', txid = ?, fee_atomic = ?, sent_at = ?, debit_ledger_id = ?, failure_reason = NULL
        WHERE id = ? AND status = 'processing'`)
        .run(txid, feeAtomic, sentAt, debitId, withdrawalId);

      db.prepare(`INSERT INTO audit_log
        (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
        VALUES (?, 'user', ?, 'withdrawal.auto_sent', 'withdrawal', ?, ?, ?)`)
        .run(`audit-${crypto.randomUUID()}`, user.id, withdrawalId, JSON.stringify({ txid, amountYerb, destination, feeAtomic, processingAt }), sentAt);

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return NextResponse.json({
      id: withdrawalId,
      status: 'sent',
      amountYerb,
      destinationAddress: destination,
      txid,
      feeYerb: feeAtomic / ATOMIC,
      autoSubmitted: true,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not auto-submit withdrawal.';
    db.prepare("UPDATE withdrawals SET status = 'approved', failure_reason = ? WHERE id = ? AND status = 'processing'")
      .run(message.slice(0, 500), withdrawalId);
    return NextResponse.json({
      id: withdrawalId,
      status: 'approved',
      amountYerb,
      destinationAddress: destination,
      autoSubmitted: false,
      warning: message,
    }, { status: 201 });
  }
}
