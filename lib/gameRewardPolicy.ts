import 'server-only';
import { getDatabase } from '@/lib/sqlite';

export type GameRewardPolicy = {
  enabled: boolean;
  classicEnabled: boolean;
  huntEnabled: boolean;
  dailyEnabled: boolean;
  yerbPerPoint: number;
  dailyCapYerb: number;
  perGameCapYerb: number;
  reviewRequired: boolean;
  rewardCooldownMinutes: number;
  maxRewardedGamesPerDay: number;
  huntMaxGuesses: number;
  huntWinRadiusKm: number;
  huntStateClueGuess: number;
  huntCityClueGuess: number;
};

export const DEFAULT_GAME_REWARD_POLICY: GameRewardPolicy = {
  enabled: true,
  classicEnabled: true,
  huntEnabled: true,
  dailyEnabled: true,
  yerbPerPoint: Number(process.env.NEXT_PUBLIC_YERB_PER_POINT || 0.0004),
  dailyCapYerb: Number(process.env.NEXT_PUBLIC_YERB_DAILY_CAP || 25),
  perGameCapYerb: 10,
  reviewRequired: true,
  rewardCooldownMinutes: 0,
  maxRewardedGamesPerDay: 0,
  huntMaxGuesses: 10,
  huntWinRadiusKm: 10,
  huntStateClueGuess: 3,
  huntCityClueGuess: 6,
};

const KEY = 'game_reward_policy';

function finiteNonNegative(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function integerNonNegative(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getGameRewardPolicy(): GameRewardPolicy {
  const db = getDatabase();
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(KEY) as { value_json?: string } | undefined;
  if (!row?.value_json) return DEFAULT_GAME_REWARD_POLICY;
  try {
    const value = JSON.parse(row.value_json) as Partial<GameRewardPolicy>;
    return {
      enabled: value.enabled !== false,
      classicEnabled: value.classicEnabled !== false,
      huntEnabled: value.huntEnabled !== false,
      dailyEnabled: value.dailyEnabled !== false,
      yerbPerPoint: finiteNonNegative(value.yerbPerPoint, DEFAULT_GAME_REWARD_POLICY.yerbPerPoint),
      dailyCapYerb: finiteNonNegative(value.dailyCapYerb, DEFAULT_GAME_REWARD_POLICY.dailyCapYerb),
      perGameCapYerb: finiteNonNegative(value.perGameCapYerb, DEFAULT_GAME_REWARD_POLICY.perGameCapYerb),
      reviewRequired: value.reviewRequired !== false,
      rewardCooldownMinutes: integerNonNegative(value.rewardCooldownMinutes, DEFAULT_GAME_REWARD_POLICY.rewardCooldownMinutes),
      maxRewardedGamesPerDay: integerNonNegative(value.maxRewardedGamesPerDay, DEFAULT_GAME_REWARD_POLICY.maxRewardedGamesPerDay),
      huntMaxGuesses: positiveInteger(value.huntMaxGuesses, DEFAULT_GAME_REWARD_POLICY.huntMaxGuesses),
      huntWinRadiusKm: positiveNumber(value.huntWinRadiusKm, DEFAULT_GAME_REWARD_POLICY.huntWinRadiusKm),
      huntStateClueGuess: positiveInteger(value.huntStateClueGuess, DEFAULT_GAME_REWARD_POLICY.huntStateClueGuess),
      huntCityClueGuess: positiveInteger(value.huntCityClueGuess, DEFAULT_GAME_REWARD_POLICY.huntCityClueGuess),
    };
  } catch {
    return DEFAULT_GAME_REWARD_POLICY;
  }
}

export function saveGameRewardPolicy(policy: GameRewardPolicy, adminId: string) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO app_settings (key,value_json,public,updated_by_admin_id,updated_at)
              VALUES (?,?,1,?,?)
              ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, public=1,
                updated_by_admin_id=excluded.updated_by_admin_id, updated_at=excluded.updated_at`)
    .run(KEY, JSON.stringify(policy), adminId, now);
  return policy;
}

export function calculateGameReward(score: number, policy = getGameRewardPolicy()) {
  if (!policy.enabled) return 0;
  const safeScore = Math.max(0, Math.min(25000, Number(score) || 0));
  const raw = safeScore * policy.yerbPerPoint;
  return Number(Math.min(raw, policy.perGameCapYerb).toFixed(8));
}

export function getGameplayRewardTimingStatus(walletId: string, policy = getGameRewardPolicy()) {
  const db = getDatabase();
  const today = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const rows = db.prepare(`SELECT created_at FROM wallet_ledger
                           WHERE wallet_id=? AND reference_type='game_reward'
                             AND status IN ('pending','held','posted') AND created_at>=?
                           ORDER BY created_at DESC`).all(walletId, today) as { created_at: string }[];
  const rewardedGamesToday = rows.length;
  if (policy.maxRewardedGamesPerDay > 0 && rewardedGamesToday >= policy.maxRewardedGamesPerDay) {
    return { allowed: false, reason: 'daily_game_limit', rewardedGamesToday, retryAfterSeconds: 0 };
  }
  if (policy.rewardCooldownMinutes > 0 && rows[0]?.created_at) {
    const last = Date.parse(rows[0].created_at);
    const cooldownMs = policy.rewardCooldownMinutes * 60_000;
    const remainingMs = last + cooldownMs - Date.now();
    if (remainingMs > 0) return { allowed: false, reason: 'cooldown', rewardedGamesToday, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
  }
  return { allowed: true, reason: 'ok', rewardedGamesToday, retryAfterSeconds: 0 };
}
