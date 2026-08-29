import 'server-only';
import { getDatabase } from '@/lib/sqlite';

export type GameRewardPolicy = {
  enabled: boolean;
  yerbPerPoint: number;
  dailyCapYerb: number;
  perGameCapYerb: number;
  reviewRequired: boolean;
};

export const DEFAULT_GAME_REWARD_POLICY: GameRewardPolicy = {
  enabled: true,
  yerbPerPoint: Number(process.env.NEXT_PUBLIC_YERB_PER_POINT || 0.0004),
  dailyCapYerb: Number(process.env.NEXT_PUBLIC_YERB_DAILY_CAP || 25),
  perGameCapYerb: 10,
  reviewRequired: true,
};

const KEY = 'game_reward_policy';

function finiteNonNegative(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getGameRewardPolicy(): GameRewardPolicy {
  const db = getDatabase();
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(KEY) as { value_json?: string } | undefined;
  if (!row?.value_json) return DEFAULT_GAME_REWARD_POLICY;
  try {
    const value = JSON.parse(row.value_json) as Partial<GameRewardPolicy>;
    return {
      enabled: value.enabled !== false,
      yerbPerPoint: finiteNonNegative(value.yerbPerPoint, DEFAULT_GAME_REWARD_POLICY.yerbPerPoint),
      dailyCapYerb: finiteNonNegative(value.dailyCapYerb, DEFAULT_GAME_REWARD_POLICY.dailyCapYerb),
      perGameCapYerb: finiteNonNegative(value.perGameCapYerb, DEFAULT_GAME_REWARD_POLICY.perGameCapYerb),
      reviewRequired: value.reviewRequired !== false,
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
