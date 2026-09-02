import SiteHeader from '@/components/SiteHeader';
import { getGameRewardPolicy, calculateGameReward } from '@/lib/gameRewardPolicy';
import { MAX_GAME_SCORE } from '@/lib/yerbasRewards';

export const metadata = { title: 'YERB Rewards · GeoWeedo' };
export const dynamic = 'force-dynamic';

function formatYerb(value: number) {
  return Number(value.toFixed(8)).toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export default function RewardsPage() {
  const policy = getGameRewardPolicy();
  const perfectReward = calculateGameReward(MAX_GAME_SCORE, policy);

  return (
    <main className="info-shell">
      <SiteHeader />
      <section className="info-hero">
        <span className="eyebrow">YERB REWARDS</span>
        <h1>Play well. Earn Yerbas.</h1>
        <p>
          {policy.enabled
            ? 'Verified, skill-based GeoWeedo gameplay can earn YERB without requiring an entry fee. Rewards are tied to score, then checked against the current game and daily limits before payout.'
            : 'Gameplay YERB rewards are currently paused by GeoWeedo Admin. Your game scores are still recorded normally while rewards are paused.'}
        </p>
      </section>

      <section className="reward-callout" aria-label="Current gameplay reward policy">
        <div>
          <span>Current YERB per point</span>
          <strong>{formatYerb(policy.yerbPerPoint)} YERB</strong>
        </div>
        <div>
          <span>Maximum reward per game</span>
          <strong>{formatYerb(policy.perGameCapYerb)} YERB</strong>
        </div>
        <div>
          <span>Daily reward cap</span>
          <strong>{formatYerb(policy.dailyCapYerb)} YERB</strong>
        </div>
      </section>

      <section className="info-grid two-col">
        <article>
          <h2>Score stays pure</h2>
          <p>Your map score is still based only on distance. At the current policy rate, a perfect {MAX_GAME_SCORE.toLocaleString()}-point game can earn up to {formatYerb(perfectReward)} YERB.</p>
        </article>
        <article>
          <h2>Wallet payouts</h2>
          <p>The payout layer requires a player account and verified Yerbas address before coins are sent.</p>
        </article>
        <article>
          <h2>Anti-abuse first</h2>
          <p>Repeated automation, duplicate accounts and obviously manipulated games are checked before the reward wallet sends funds.</p>
        </article>
        <article>
          <h2>Current policy</h2>
          <p>The YERB-per-point rate, per-game cap and daily cap shown above come directly from GeoWeedo Admin and update whenever the gameplay reward policy changes.{policy.reviewRequired ? ' Reward review is currently required.' : ''}</p>
        </article>
      </section>
    </main>
  );
}
