import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { getGameRewardPolicy, saveGameRewardPolicy, type GameRewardPolicy } from '@/lib/gameRewardPolicy';

export const runtime = 'nodejs';

function cleanPolicy(body: any): GameRewardPolicy {
  const yerbPerPoint = Number(body?.yerbPerPoint ?? 0);
  const classicPerfectRewardYerb = Number(body?.classicPerfectRewardYerb);
  const huntPerfectRewardYerb = Number(body?.huntPerfectRewardYerb);
  const dailyPerfectRewardYerb = Number(body?.dailyPerfectRewardYerb);
  const dailyCapYerb = Number(body?.dailyCapYerb);
  const perGameCapYerb = Number(body?.perGameCapYerb ?? 0);
  const rewardCooldownMinutes = Number(body?.rewardCooldownMinutes);
  const maxRewardedGamesPerDay = Number(body?.maxRewardedGamesPerDay);
  const huntMaxGuesses = Number(body?.huntMaxGuesses);
  const huntWinRadiusKm = Number(body?.huntWinRadiusKm);
  const huntStateClueGuess = Number(body?.huntStateClueGuess);
  const huntCityClueGuess = Number(body?.huntCityClueGuess);
  if (![classicPerfectRewardYerb, huntPerfectRewardYerb, dailyPerfectRewardYerb, dailyCapYerb].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('Game reward values and daily cap must be non-negative numbers.');
  if (!Number.isInteger(rewardCooldownMinutes) || rewardCooldownMinutes < 0) throw new Error('Reward cooldown must be a non-negative whole number of minutes.');
  if (!Number.isInteger(maxRewardedGamesPerDay) || maxRewardedGamesPerDay < 0) throw new Error('Daily rewarded-game limit must be a non-negative whole number.');
  if (!Number.isInteger(huntMaxGuesses) || huntMaxGuesses < 1 || huntMaxGuesses > 25) throw new Error('Hunt maximum guesses must be between 1 and 25.');
  if (!Number.isFinite(huntWinRadiusKm) || huntWinRadiusKm <= 0 || huntWinRadiusKm > 100) throw new Error('Hunt win radius must be between 0 and 100 km.');
  if (!Number.isInteger(huntStateClueGuess) || huntStateClueGuess < 1 || huntStateClueGuess > huntMaxGuesses) throw new Error('State clue guess must be within the Hunt guess limit.');
  if (!Number.isInteger(huntCityClueGuess) || huntCityClueGuess < 1 || huntCityClueGuess > huntMaxGuesses) throw new Error('City clue guess must be within the Hunt guess limit.');
  return {
    enabled: Boolean(body?.enabled), classicEnabled: body?.classicEnabled !== false, huntEnabled: body?.huntEnabled !== false, dailyEnabled: body?.dailyEnabled !== false,
    yerbPerPoint: Number.isFinite(yerbPerPoint) && yerbPerPoint >= 0 ? yerbPerPoint : 0,
    classicPerfectRewardYerb, huntPerfectRewardYerb, dailyPerfectRewardYerb,
    dailyCapYerb,
    perGameCapYerb: Number.isFinite(perGameCapYerb) && perGameCapYerb >= 0 ? perGameCapYerb : 0,
    reviewRequired: body?.reviewRequired !== false,
    rewardCooldownMinutes, maxRewardedGamesPerDay, huntMaxGuesses, huntWinRadiusKm, huntStateClueGuess, huntCityClueGuess,
  };
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ policy: getGameRewardPolicy() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const policy = cleanPolicy(await request.json());
    saveGameRewardPolicy(policy, admin.id);
    const db = getDatabase();
    db.prepare(`INSERT INTO audit_log (id,actor_type,actor_id,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(`audit-${crypto.randomUUID()}`, 'admin', admin.id, 'update_game_reward_policy', 'app_setting', 'game_reward_policy', JSON.stringify(policy), new Date().toISOString());
    return NextResponse.json({ policy });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save reward policy.' }, { status: 400 });
  }
}
