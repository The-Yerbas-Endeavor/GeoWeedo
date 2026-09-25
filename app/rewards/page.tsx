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
    <main className="info-shell rewards-page">
<section className="info-hero rewards-hero">
        <span className="eyebrow">YERB REWARDS</span>
        <h1>Play GeoWeedo. Earn YERB.</h1>
        <p>
          {policy.enabled
            ? 'Eligible skill-based GeoWeedo gameplay can earn YERB. Rewards are tied to score and checked against the current per-game and daily limits before payout.'
            : 'Gameplay YERB rewards are currently paused by GeoWeedo Admin. Your game scores are still recorded normally while rewards are paused.'}
        </p>
      </section>

      <section className="yerb-about" aria-labelledby="what-is-yerb">
        <div className="yerb-about-copy">
          <span className="eyebrow">ABOUT THE REWARD</span>
          <h2 id="what-is-yerb">What is YERB?</h2>
          <p>
            YERB is the native cryptocurrency of the Yerbas blockchain. GeoWeedo uses YERB as an optional gameplay reward currency, while the Yerbas network, wallet software, explorer, and source code operate independently of GeoWeedo.
          </p>
        </div>
        <div className="yerb-resource-links" aria-label="Yerbas resources">
          <a href="https://yerbas.org/" target="_blank" rel="noreferrer"><strong>Yerbas</strong><span>Project website ↗</span></a>
          <a href="https://docs.yerbas.org/" target="_blank" rel="noreferrer"><strong>Documentation</strong><span>Wallets, nodes &amp; guides ↗</span></a>
          <a href="https://explorer.yerbas.org/" target="_blank" rel="noreferrer"><strong>Block Explorer</strong><span>Network &amp; transaction data ↗</span></a>
          <a href="https://github.com/The-Yerbas-Endeavor/yerbas" target="_blank" rel="noreferrer"><strong>Source Code</strong><span>Yerbas Core on GitHub ↗</span></a>
        </div>
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
