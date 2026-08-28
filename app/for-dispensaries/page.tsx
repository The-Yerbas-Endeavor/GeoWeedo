import SiteHeader from '@/components/SiteHeader';

export const metadata = { title: 'For Dispensaries · GeoWeedo' };

export default function ForDispensariesPage() {
  return (
    <main className="info-shell">
      <SiteHeader />
      <section className="info-hero">
        <span className="eyebrow">FOR DISPENSARIES</span>
        <h1>Put your storefront on the map.</h1>
        <p>Verified dispensaries can be included in GeoWeedo rounds after imagery review. Priority placement can later be purchased with YERB and will always be labeled and capped so sponsored businesses do not take over the game.</p>
      </section>
      <section className="info-grid two-col">
        <article><h2>Verified listing</h2><p>Business identity, coordinates and starting imagery are reviewed before a dispensary can appear in live rounds.</p></article>
        <article><h2>Priority with YERB</h2><p>Sponsored listings can receive a controlled boost in eligible non-daily games. The payment and promotion period will be recorded on-chain and in GeoWeedo.</p></article>
        <article><h2>Fairness cap</h2><p>Sponsored placement will be limited to a small share of each game and will never alter scoring or reveal hidden gameplay information.</p></article>
        <article><h2>Future business dashboard</h2><p>Dispensaries will be able to verify their listing, fund promotion with YERB, see impression/game counts and manage active campaigns.</p></article>
      </section>
    </main>
  );
}
