import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { getUserFromRequest } from '@/lib/userAuth';

export const runtime = 'nodejs';
const ATOMIC = 100_000_000;

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user || !user.walletId) return NextResponse.json({ error: 'Login required.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const destination = String(body?.destinationAddress || '').trim();
  const amountYerb = Number(body?.amountYerb);
  if (destination.length < 20 || destination.length > 80) return NextResponse.json({ error: 'Enter a valid Yerbas destination address.' }, { status: 400 });
  if (!Number.isFinite(amountYerb) || amountYerb <= 0) return NextResponse.json({ error: 'Enter a valid withdrawal amount.' }, { status: 400 });

  const amountAtomic = Math.round(amountYerb * ATOMIC);
  if (!Number.isSafeInteger(amountAtomic) || amountAtomic <= 0) return NextResponse.json({ error: 'Withdrawal amount is outside the supported range.' }, { status: 400 });

  const db = getDatabase();
  const now = new Date().toISOString();
  const withdrawalId = `wd-${crypto.randomUUID()}`;
  const holdId = `ledger-${crypto.randomUUID()}`;

  db.exec('BEGIN IMMEDIATE');
  try {
    const posted = db.prepare("SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger WHERE wallet_id = ? AND status = 'posted'").get(user.walletId) as any;
    const held = db.prepare("SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger WHERE wallet_id = ? AND status = 'held'").get(user.walletId) as any;
    const available = Number(posted?.amount || 0) + Number(held?.amount || 0);
    if (amountAtomic > available) {
      db.exec('ROLLBACK');
      return NextResponse.json({ error: 'Insufficient available YERB balance.' }, { status: 400 });
    }

    db.prepare(`INSERT INTO wallet_ledger (id, wallet_id, entry_type, amount_atomic, status, reference_type, reference_id, memo, created_at)
                VALUES (?, ?, 'withdrawal_hold', ?, 'held', 'withdrawal', ?, ?, ?)`)
      .run(holdId, user.walletId, -amountAtomic, withdrawalId, `Withdrawal hold to ${destination}`, now);
    db.prepare(`INSERT INTO withdrawals (id, wallet_id, destination_address, amount_atomic, fee_atomic, status, requested_at, hold_ledger_id)
                VALUES (?, ?, ?, ?, 0, 'requested', ?, ?)`)
      .run(withdrawalId, user.walletId, destination, amountAtomic, now, holdId);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }

  return NextResponse.json({ id: withdrawalId, status: 'requested', amountYerb: amountAtomic / ATOMIC, destinationAddress: destination }, { status: 201 });
}
