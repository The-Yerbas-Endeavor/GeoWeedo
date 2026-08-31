import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureFinanceSchema, postSystemLedgerEntry } from '@/lib/financeLedger';
import { calculateGameReward, getGameRewardPolicy } from '@/lib/gameRewardPolicy';
import { getDatabase } from '@/lib/sqlite';
import { getUserFromRequest } from '@/lib/userAuth';

export const runtime = 'nodejs';
const ATOMIC = 100_000_000;
const MAX_ROUNDS = 5;
const MAX_ROUND_SCORE = 5000;

function mapStatus(status: string) {
  if (status === 'posted') return 'earned';
  if (status === 'held' || status === 'pending') return 'pending_review';
  return status;
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user || !user.walletId) return NextResponse.json({ error: 'Sign in to earn gameplay rewards.' }, { status: 401 });
  if (!user.rewardEligible) return NextResponse.json({ error: 'This account is not reward eligible.' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const gameId = String(body?.gameId || '').trim();
  const scores = Array.isArray(body?.scores) ? body.scores.map(Number) : [];
  const dispensaryIds = Array.isArray(body?.dispensaryIds) ? body.dispensaryIds.map((value: unknown) => String(value)) : [];
  const startedAt = typeof body?.startedAt === 'string' && !Number.isNaN(Date.parse(body.startedAt)) ? body.startedAt : new Date().toISOString();

  if (!/^game-[A-Za-z0-9-]{8,80}$/.test(gameId)) return NextResponse.json({ error: 'Invalid game reference.' }, { status: 400 });
  if (!scores.length || scores.length > MAX_ROUNDS || scores.length !== dispensaryIds.length) return NextResponse.json({ error: 'Invalid completed game.' }, { status: 400 });
  if (scores.some((score: number) => !Number.isInteger(score) || score < 0 || score > MAX_ROUND_SCORE)) return NextResponse.json({ error: 'Invalid round score.' }, { status: 400 });
  if (new Set(dispensaryIds).size !== dispensaryIds.length) return NextResponse.json({ error: 'Duplicate gameplay location.' }, { status: 400 });

  const db = getDatabase();
  ensureFinanceSchema(db);

  const existingGame = db.prepare('SELECT id,user_id,total_score,reward_atomic,reward_status FROM games WHERE id=?').get(gameId) as any;
  if (existingGame) {
    if (existingGame.user_id !== user.id) return NextResponse.json({ error: 'Game reference already exists.' }, { status: 409 });
    const ledger = db.prepare("SELECT status,amount_atomic FROM wallet_ledger WHERE wallet_id=? AND reference_type='game_reward' AND reference_id=? ORDER BY created_at LIMIT 1").get(user.walletId, gameId) as any;
    return NextResponse.json({
      gameId,
      totalScore: Number(existingGame.total_score || 0),
      amountYerb: Number(ledger?.amount_atomic || existingGame.reward_atomic || 0) / ATOMIC,
      status: mapStatus(String(ledger?.status || existingGame.reward_status || 'not_eligible')),
      duplicate: true,
    });
  }

  const placeholders = dispensaryIds.map(() => '?').join(',');
  const validRows = db.prepare(`SELECT id FROM dispensaries WHERE id IN (${placeholders}) AND active=1 AND verified=1 AND imagery_photo_id IS NOT NULL AND imagery_photo_id<>''`).all(...dispensaryIds) as any[];
  if (validRows.length !== dispensaryIds.length) return NextResponse.json({ error: 'One or more gameplay locations are no longer eligible.' }, { status: 409 });

  const policy = getGameRewardPolicy();
  const totalScore = scores.reduce((sum: number, score: number) => sum + score, 0);
  const baseReward = calculateGameReward(totalScore, policy);
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
                VALUES (?,?,'standard','completed',?,?,?,?,?,?)`)
      .run(gameId, user.id, totalScore, amountAtomic, rewardStatus, startedAt, now, 'web');

    const insertRound = db.prepare(`INSERT INTO game_rounds (id,game_id,dispensary_id,round_number,score,started_at,completed_at)
                                    VALUES (?,?,?,?,?,?,?)`);
    scores.forEach((score: number, index: number) => {
      insertRound.run(`round-${crypto.randomUUID()}`, gameId, dispensaryIds[index], index + 1, score, startedAt, now);
    });

    if (amountAtomic > 0) {
      const ledgerId = `ledger-${crypto.randomUUID()}`;
      db.prepare(`INSERT INTO wallet_ledger (id,wallet_id,entry_type,amount_atomic,status,reference_type,reference_id,memo,metadata_json,created_at,posted_at)
                  VALUES (?,?,?,?,?,'game_reward',?,'GeoWeedo gameplay reward',?,?,?)`)
        .run(ledgerId, user.walletId, ledgerStatus === 'posted' ? 'reward_credit' : 'reward_pending', amountAtomic, ledgerStatus, gameId,
          JSON.stringify({ totalScore, rounds: scores.length, reviewRequired: policy.reviewRequired }), now, ledgerStatus === 'posted' ? now : null);

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
          memo: 'GeoWeedo gameplay reward',
          metadata: { userId: user.id, totalScore },
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
    totalScore,
    amountYerb,
    status: amountAtomic <= 0 ? 'daily_cap_reached' : mapStatus(ledgerStatus),
    dailyCapYerb: policy.dailyCapYerb,
    dailyRemainingYerb: Number(Math.max(0, remainingDaily - amountYerb).toFixed(8)),
    reviewRequired: policy.reviewRequired,
  }, { status: 201 });
}
