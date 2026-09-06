import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { listCandidates } from '@/lib/candidateStore';
import { ensureFinanceSchema, postSystemLedgerEntry } from '@/lib/financeLedger';
import { calculateGameReward, getGameRewardPolicy } from '@/lib/gameRewardPolicy';
import { getDatabase } from '@/lib/sqlite';
import { getUserFromRequest } from '@/lib/userAuth';

export const runtime = 'nodejs';
const ATOMIC = 100_000_000;
const MAX_HUNT_SCORE = 5000;
const MAX_GUESSES = 8;

function mapStatus(status: string) {
  if (status === 'posted') return 'earned';
  if (status === 'held' || status === 'pending') return 'pending_review';
  return status;
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user || !user.walletId) return NextResponse.json({ error: 'Sign in to earn Weedo Hunt rewards.' }, { status: 401 });
  if (!user.rewardEligible) return NextResponse.json({ error: 'This account is not reward eligible.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const gameId = String(body?.gameId || '').trim();
  const targetId = String(body?.targetId || '').trim();
  const score = Number(body?.score);
  const guesses = Number(body?.guesses);
  const distanceKm = Number(body?.distanceKm);
  const startedAt = typeof body?.startedAt === 'string' && !Number.isNaN(Date.parse(body.startedAt)) ? body.startedAt : new Date().toISOString();

  if (!/^hunt-[A-Za-z0-9-]{8,80}$/.test(gameId)) return NextResponse.json({ error: 'Invalid hunt reference.' }, { status: 400 });
  if (!targetId) return NextResponse.json({ error: 'Missing hunt target.' }, { status: 400 });
  if (!Number.isInteger(score) || score < 0 || score > MAX_HUNT_SCORE) return NextResponse.json({ error: 'Invalid hunt score.' }, { status: 400 });
  if (!Number.isInteger(guesses) || guesses < 1 || guesses > MAX_GUESSES) return NextResponse.json({ error: 'Invalid guess count.' }, { status: 400 });
  if (!Number.isFinite(distanceKm) || distanceKm < 0 || distanceKm >= 2) return NextResponse.json({ error: 'The hunt was not completed within the 2 km win radius.' }, { status: 400 });

  const candidates = await listCandidates();
  const target = candidates.find((item) => item.id === targetId && item.status !== 'rejected' && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  if (!target) return NextResponse.json({ error: 'Hunt target is no longer eligible.' }, { status: 409 });

  const db = getDatabase();
  ensureFinanceSchema(db);

  const existingGame = db.prepare('SELECT id,user_id,total_score,reward_atomic,reward_status FROM games WHERE id=?').get(gameId) as any;
  if (existingGame) {
    if (existingGame.user_id !== user.id) return NextResponse.json({ error: 'Hunt reference already exists.' }, { status: 409 });
    const ledger = db.prepare("SELECT status,amount_atomic FROM wallet_ledger WHERE wallet_id=? AND reference_type='game_reward' AND reference_id=? ORDER BY created_at LIMIT 1").get(user.walletId, gameId) as any;
    return NextResponse.json({
      gameId,
      totalScore: Number(existingGame.total_score || 0),
      amountYerb: Number(ledger?.amount_atomic || existingGame.reward_atomic || 0) / ATOMIC,
      status: mapStatus(String(ledger?.status || existingGame.reward_status || 'not_eligible')),
      duplicate: true,
    });
  }

  const policy = getGameRewardPolicy();
  const baseReward = calculateGameReward(score, policy);
  const today = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const daily = db.prepare(`SELECT COALESCE(SUM(amount_atomic),0) AS amount FROM wallet_ledger
                            WHERE wallet_id=? AND reference_type='game_reward'
                              AND status IN ('pending','held','posted') AND created_at>=?`).get(user.walletId, today) as any;
  const usedToday = Number(daily?.amount || 0) / ATOMIC;
  const remainingDaily = Math.max(0, policy.dailyCapYerb - usedToday);
  const amountYerb = Number(Math.min(baseReward, remainingDaily).toFixed(8));
  const amountAtomic = Math.round(amountYerb * ATOMIC);
  const now = new Date().toISOString();
  const ledgerStatus = policy.reviewRequired ? 'held' : 'posted';
  const rewardStatus = amountAtomic <= 0 ? 'daily_cap_reached' : ledgerStatus;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO games (id,user_id,mode,status,total_score,reward_atomic,reward_status,started_at,completed_at,client_version)
                VALUES (?,?,'hunt','completed',?,?,?,?,?,?)`)
      .run(gameId, user.id, score, amountAtomic, rewardStatus, startedAt, now, 'web');

    if (amountAtomic > 0) {
      const ledgerId = `ledger-${crypto.randomUUID()}`;
      db.prepare(`INSERT INTO wallet_ledger (id,wallet_id,entry_type,amount_atomic,status,reference_type,reference_id,memo,metadata_json,created_at,posted_at)
                  VALUES (?,?,?,?,?,'game_reward',?,'Weedo Hunt reward',?,?,?)`)
        .run(ledgerId, user.walletId, ledgerStatus === 'posted' ? 'reward_credit' : 'reward_pending', amountAtomic, ledgerStatus, gameId,
          JSON.stringify({ mode: 'hunt', targetId, targetName: target.name, score, guesses, distanceKm, reviewRequired: policy.reviewRequired }), now, ledgerStatus === 'posted' ? now : null);

      db.prepare(`INSERT INTO reward_claims (id,user_id,game_id,wallet_id,amount_atomic,status,ledger_id,created_at,updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(`claim-${crypto.randomUUID()}`, user.id, gameId, user.walletId, amountAtomic, ledgerStatus, ledgerId, now, now);

      if (ledgerStatus === 'posted') {
        postSystemLedgerEntry({
          accountCode: 'rewards_pool',
          entryType: 'reward_expense',
          amountAtomic: -amountAtomic,
          referenceType: 'game_reward',
          referenceId: gameId,
          memo: 'Weedo Hunt reward',
          metadata: { userId: user.id, mode: 'hunt', targetId, score, guesses, distanceKm },
        }, db);
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return NextResponse.json({
    gameId,
    totalScore: score,
    amountYerb,
    status: amountAtomic <= 0 ? 'daily_cap_reached' : mapStatus(ledgerStatus),
    dailyCapYerb: policy.dailyCapYerb,
    dailyRemainingYerb: Number(Math.max(0, remainingDaily - amountYerb).toFixed(8)),
    reviewRequired: policy.reviewRequired,
  }, { status: 201 });
}
