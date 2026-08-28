import SiteHeader from '@/components/SiteHeader';
import { DEFAULT_DAILY_YERB_CAP, DEFAULT_YERB_PER_POINT, MAX_GAME_SCORE, yerbFromScore } from '@/lib/yerbasRewards';

export const metadata = { title: 'YERB Rewards · GeoWeedo' };

export default function RewardsPage() {
  const perfectReward = yerbFromScore(MAX_GAME_SCORE, DEFAULT_YERB_PER_POINT);
  return (
    <main className="info-shell">
      <SiteHeader />
      <section className="info-hero">
        <span className="eyebrow">YERB REWARDS</span>
        <h1>Play well. Earn Yerbas.</h1>
        <p>GeoWeedo is being designed so verified, skill-based gameplay can earn YERB without requiring an entry fee. Rewards are tied to score, then checked against daily limits and anti-abuse rules before payout.</p>
      </section>
      <section className="reward-callout">
        <div><span>Default perfect-game estimate</span><strong>{perfectReward} YERB</strong></div>
        <div><span>Default daily reward cap</span><strong>{DEFAULT_DAILY_YERB_CAP} YERB</strong></div>
        <div><span>Maximum game score</span><strong>{MAX_GAME_SCORE.toLocaleString()} pts</strong></div>
      </section>
      <section className="info-grid two-col">
        <article><h2>Score stays pure</h2><p>Your map score is still based only on distance. YERB is calculated from the completed score after the game.</p></article>
        <article><h2>Wallet payouts</h2><p>The payout layer will require a player account and verified Yerbas address before any coins are sent.</p></article>
        <article><h2>Anti-abuse first</h2><p>Repeated automation, duplicate accounts and obviously manipulated games must be filtered before the reward wallet sends funds.</p></article>
        <article><h2>Configurable economics</h2><p>The YERB-per-point rate and daily cap are configurable so rewards can be tuned without changing the scoring system.</p></article>
      </section>
    </main>
  );
}
