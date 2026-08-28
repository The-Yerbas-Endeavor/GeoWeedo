import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { getUserFromRequest } from '@/lib/userAuth';

export const runtime = 'nodejs';
const ATOMIC = 100_000_000;

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user || !user.walletId) return NextResponse.json({ error: 'Login required.' }, { status: 401 });
  const db = getDatabase();
  const posted = db.prepare("SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger WHERE wallet_id = ? AND status = 'posted'").get(user.walletId) as any;
  const held = db.prepare("SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger WHERE wallet_id = ? AND status = 'held'").get(user.walletId) as any;
  const address = db.prepare("SELECT address FROM wallet_addresses WHERE wallet_id = ? AND address_type = 'deposit' AND active = 1 ORDER BY created_at LIMIT 1").get(user.walletId) as any;
  const withdrawals = db.prepare('SELECT id, destination_address, amount_atomic, fee_atomic, status, requested_at, txid, failure_reason FROM withdrawals WHERE wallet_id = ? ORDER BY requested_at DESC LIMIT 25').all(user.walletId) as any[];
  const deposits = db.prepare('SELECT id, address, txid, amount_atomic, confirmations, status, detected_at, confirmed_at FROM deposits WHERE wallet_id = ? ORDER BY detected_at DESC LIMIT 25').all(user.walletId) as any[];
  const postedAtomic = Number(posted?.amount || 0);
  const heldAtomic = Number(held?.amount || 0);
  return NextResponse.json({
    user,
    wallet: {
      id: user.walletId,
      currency: 'YERB',
      balanceAtomic: postedAtomic,
      heldAtomic: Math.abs(heldAtomic),
      availableAtomic: postedAtomic + heldAtomic,
      balanceYerb: postedAtomic / ATOMIC,
      availableYerb: (postedAtomic + heldAtomic) / ATOMIC,
      depositAddress: address?.address || null,
    },
    deposits,
    withdrawals,
  });
}
