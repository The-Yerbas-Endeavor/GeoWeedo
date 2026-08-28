import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { ensureFinanceSchema, postSystemLedgerEntry } from '@/lib/financeLedger';
import { getDatabase } from '@/lib/sqlite';

export const runtime = 'nodejs';
const ATOMIC = 100_000_000;

function mapReward(row: any) {
  return {
    id: row.id,
    playerId: row.user_id,
    amountYerb: Number(row.amount_atomic) / ATOMIC,
    reason: row.memo || 'GeoWeedo reward',
    reference: row.reference_id || undefined,
    status: row.status,
    txid: row.txid || undefined,
    createdAt: row.created_at,
    paidAt: row.posted_at || undefined,
  };
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const db = getDatabase();
  ensureFinanceSchema(db);
  const players = db.prepare(`SELECT u.id, COALESCE(u.display_name, u.username, 'Player') AS handle, u.yerbas_address AS yerbasAddress,
                                     u.wallet_verified_at AS walletVerifiedAt, u.reward_eligible AS rewardEligible
                              FROM users u JOIN wallets w ON w.user_id = u.id
                              WHERE u.reward_eligible = 1 AND u.wallet_verified_at IS NOT NULL AND u.account_status = 'active'
                              ORDER BY handle COLLATE NOCASE`).all().map((row: any) => ({ ...row, rewardEligible: Boolean(row.rewardEligible) }));
  const rewards = db.prepare(`SELECT l.*, w.user_id FROM wallet_ledger l JOIN wallets w ON w.id = l.wallet_id
                              WHERE l.entry_type IN ('reward_pending','reward_credit') OR l.reference_type IN ('reward','game_reward','admin_reward')
                              ORDER BY l.created_at`).all().map(mapReward);
  return NextResponse.json({ rewards, players }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const playerId = String(body?.playerId || '');
  const amount = Number(body?.amountYerb);
  const reference = String(body?.reference || '').trim() || `manual-${crypto.randomUUID()}`;
  if (!playerId || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'playerId and positive amountYerb are required.' }, { status: 400 });

  const db = getDatabase();
  ensureFinanceSchema(db);
  const player = db.prepare(`SELECT u.id, w.id AS wallet_id FROM users u JOIN wallets w ON w.user_id = u.id
                             WHERE u.id = ? AND u.reward_eligible = 1 AND u.wallet_verified_at IS NOT NULL AND u.account_status = 'active'`).get(playerId) as any;
  if (!player) return NextResponse.json({ error: 'Player is not reward eligible.' }, { status: 400 });
  const duplicate = db.prepare(`SELECT id FROM wallet_ledger WHERE reference_type = 'admin_reward' AND reference_id = ?`).get(reference);
  if (duplicate) return NextResponse.json({ error: 'That reward reference already exists.' }, { status: 409 });

  const id = `ledger-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const amountAtomic = Math.round(amount * ATOMIC);
  db.prepare(`INSERT INTO wallet_ledger (id, wallet_id, entry_type, amount_atomic, status, reference_type, reference_id, memo, metadata_json, created_at)
              VALUES (?, ?, 'reward_pending', ?, 'pending', 'admin_reward', ?, ?, ?, ?)`)
    .run(id, player.wallet_id, amountAtomic, reference, String(body?.reason || 'GeoWeedo reward'), JSON.stringify({ adminId: admin.id }), now);
  const reward = mapReward({ id, user_id: playerId, amount_atomic: amountAtomic, memo: String(body?.reason || 'GeoWeedo reward'), reference_id: reference, status: 'pending', txid: null, created_at: now, posted_at: null });
  return NextResponse.json({ reward }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = String(body?.id || '');
  const requested = String(body?.status || '');
  const nextStatus = requested === 'paid' ? 'posted' : requested;
  if (!id || !['pending', 'held', 'posted', 'cancelled'].includes(nextStatus)) return NextResponse.json({ error: 'Reward id and valid status are required.' }, { status: 400 });
  const db = getDatabase();
  ensureFinanceSchema(db);
  const existing = db.prepare(`SELECT l.*, w.user_id FROM wallet_ledger l JOIN wallets w ON w.id = l.wallet_id WHERE l.id = ? AND (l.entry_type IN ('reward_pending','reward_credit') OR l.reference_type IN ('reward','game_reward','admin_reward'))`).get(id) as any;
  if (!existing) return NextResponse.json({ error: 'Reward not found.' }, { status: 404 });
  if (existing.status === 'posted' && nextStatus !== 'posted') return NextResponse.json({ error: 'Posted rewards cannot be reversed through this endpoint.' }, { status: 409 });
  if (existing.status === 'posted' && nextStatus === 'posted') return NextResponse.json({ reward: mapReward(existing) });

  const now = new Date().toISOString();
  const entryType = nextStatus === 'posted' ? 'reward_credit' : 'reward_pending';
  db.exec('BEGIN IMMEDIATE');
  try {
    if (nextStatus === 'posted') {
      postSystemLedgerEntry({
        accountCode: 'rewards_pool',
        entryType: 'reward_expense',
        amountAtomic: -Number(existing.amount_atomic),
        referenceType: 'reward_credit',
        referenceId: id,
        memo: existing.memo || 'GeoWeedo reward',
        metadata: { adminId: admin.id, userId: existing.user_id },
      }, db);
    }
    db.prepare('UPDATE wallet_ledger SET status = ?, entry_type = ?, posted_at = ?, metadata_json = ? WHERE id = ?')
      .run(nextStatus, entryType, nextStatus === 'posted' ? now : null, JSON.stringify({ adminId: admin.id, reviewedAt: now }), id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const updated = db.prepare(`SELECT l.*, w.user_id FROM wallet_ledger l JOIN wallets w ON w.id = l.wallet_id WHERE l.id = ?`).get(id) as any;
  return NextResponse.json({ reward: mapReward(updated) });
}
