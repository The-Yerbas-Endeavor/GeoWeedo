import SiteHeader from '@/components/SiteHeader';

export const metadata = { title: 'How to Play · GeoWeedo' };

export default function HowToPlayPage() {
  return (
    <main className="info-shell">
      <SiteHeader />
      <section className="info-hero">
        <span className="eyebrow">HOW TO PLAY</span>
        <h1>Read the street. Find the dispensary.</h1>
        <p>Each game has five rounds. Explore the street imagery, look for geographic clues, place your guess on the map, and score up to 5,000 points per round.</p>
      </section>
      <section className="info-grid">
        <article><strong>1</strong><h2>Look around</h2><p>Use storefronts, signs, terrain, road markings, architecture and neighboring businesses as clues.</p></article>
        <article><strong>2</strong><h2>Place your pin</h2><p>Click anywhere on the guessing map. You can move the pin until you are ready to lock it in.</p></article>
        <article><strong>3</strong><h2>Score the distance</h2><p>The closer your guess is to the actual dispensary, the more points you earn. A perfect five-round game is 25,000 points.</p></article>
        <article><strong>4</strong><h2>Earn YERB</h2><p>Eligible verified play can earn YERB based on score, subject to daily caps and anti-abuse checks before payout.</p></article>
      </section>
    </main>
  );
}
