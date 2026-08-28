export const MAX_GAME_SCORE = 25000;
export const DEFAULT_YERB_PER_POINT = 0.0004;
export const DEFAULT_DAILY_YERB_CAP = 25;

export function yerbFromScore(score: number, rate = DEFAULT_YERB_PER_POINT) {
  const safeScore = Math.max(0, Math.min(MAX_GAME_SCORE, score));
  return Number((safeScore * rate).toFixed(4));
}

export function rewardPolicy() {
  const rate = Number(process.env.NEXT_PUBLIC_YERB_PER_POINT ?? DEFAULT_YERB_PER_POINT);
  const dailyCap = Number(process.env.NEXT_PUBLIC_YERB_DAILY_CAP ?? DEFAULT_DAILY_YERB_CAP);
  return {
    rate: Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_YERB_PER_POINT,
    dailyCap: Number.isFinite(dailyCap) && dailyCap >= 0 ? dailyCap : DEFAULT_DAILY_YERB_CAP,
  };
}

export function cappedYerbasReward(score: number, alreadyEarnedToday = 0) {
  const { rate, dailyCap } = rewardPolicy();
  const raw = yerbFromScore(score, rate);
  return Math.max(0, Number(Math.min(raw, Math.max(0, dailyCap - alreadyEarnedToday)).toFixed(4)));
}
