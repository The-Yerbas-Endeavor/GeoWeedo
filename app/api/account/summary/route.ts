import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { getUserFromRequest } from '@/lib/userAuth';
import { scanYerbasDeposits } from '@/lib/yerbasDepositScanner';

export const runtime = 'nodejs';
const ATOMIC = 100_000_000;

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user || !user.walletId) return NextResponse.json({ error: 'Login required.' }, { status: 401 });
  const db = getDatabase();

  try {
    await scanYerbasDeposits(db);
  } catch {
    // Admin wallet diagnostics expose RPC/scanner failures separately.
  }

  const posted = db.prepare("SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger WHERE wallet_id = ? AND status = 'posted'").get(user.walletId) as any;
  const heldDebits = db.prepare("SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger WHERE wallet_id = ? AND status = 'held' AND amount_atomic < 0").get(user.walletId) as any;
  const pendingRewards = db.prepare(`SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger
                                     WHERE wallet_id = ? AND status IN ('pending','held') AND amount_atomic > 0
                                       AND (entry_type IN ('reward_pending','reward_credit') OR reference_type IN ('reward','game_reward','admin_reward'))`).get(user.walletId) as any;
  const address = db.prepare("SELECT address FROM wallet_addresses WHERE wallet_id = ? AND address_type = 'deposit' AND active = 1 ORDER BY created_at LIMIT 1").get(user.walletId) as any;
  const withdrawals = db.prepare('SELECT id, destination_address, amount_atomic, fee_atomic, status, requested_at, txid, failure_reason FROM withdrawals WHERE wallet_id = ? ORDER BY requested_at DESC LIMIT 25').all(user.walletId) as any[];
  const deposits = db.prepare('SELECT id, address, txid, amount_atomic, confirmations, status, detected_at, confirmed_at FROM deposits WHERE wallet_id = ? ORDER BY detected_at DESC LIMIT 25').all(user.walletId) as any[];

  const postedAtomic = Number(posted?.amount || 0);
  const heldDebitAtomic = Number(heldDebits?.amount || 0);
  const pendingRewardAtomic = Math.max(0, Number(pendingRewards?.amount || 0));

  const availableAtomic = Math.max(0, postedAtomic + heldDebitAtomic);
  const heldWithdrawalAtomic = Math.max(0, -heldDebitAtomic);
  const heldAtomic = heldWithdrawalAtomic + pendingRewardAtomic;
  const totalAtomic = availableAtomic + heldAtomic;

  return NextResponse.json({
    user,
    wallet: {
      id: user.walletId,
      currency: 'YERB',
      balanceAtomic: totalAtomic,
      postedAtomic,
      pendingRewardAtomic,
      heldWithdrawalAtomic,
      heldAtomic,
      availableAtomic,
      balanceYerb: totalAtomic / ATOMIC,
      postedYerb: postedAtomic / ATOMIC,
      pendingRewardYerb: pendingRewardAtomic / ATOMIC,
      availableYerb: availableAtomic / ATOMIC,
      depositAddress: address?.address || null,
    },
    deposits,
    withdrawals,
  });
}
