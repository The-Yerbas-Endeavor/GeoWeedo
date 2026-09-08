import SiteHeader from '@/components/SiteHeader';

export const metadata = { title: 'For Dispensaries · GeoWeedo' };

export default function ForDispensariesPage() {
  return (
    <main className="info-shell">
      <SiteHeader />
      <section className="info-hero">
        <span className="eyebrow">FOR DISPENSARIES</span>
        <h1>Claim your storefront. Then make it stand out.</h1>
        <p>Claiming a GeoWeedo business listing is free. Verified owners can keep their public profile accurate, upgrade to GeoWeedo Featured, and run clearly labeled game sponsorship campaigns without changing gameplay odds.</p>
        <div className="info-actions"><a className="primary" href="/">Find & claim your listing</a><a href="/owner">Owner dashboard</a></div>
      </section>
      <section className="info-grid two-col">
        <article><h2>1. Claim your business — free</h2><p>Open your dispensary listing, choose Claim this business, and submit business contact information for verification. Approved owners can manage their profile without paying for promotion.</p></article>
        <article><h2>2. Manage your listing</h2><p>Verified owners can update their overview, phone, website, hours, amenities, social links, logo and storefront information from the GeoWeedo owner workspace.</p></article>
        <article id="featured" style={{scrollMarginTop:24}}><h2>★ GeoWeedo Featured</h2><p>Featured listings receive distinctive treatment through the normal GeoWeedo pointy-pin map system, including a larger gold Featured pin with the business logo when available, plus enhanced discovery visibility and sponsor analytics. Introductory plan: $39/month or $390/year.</p><p>Featured placement never increases the business's odds of being selected as a gameplay target.</p></article>
        <article><h2>🎮 Classic GeoWeedo Sponsor</h2><p>Presented-by and game-result exposure without influencing mystery rounds. Introductory campaign pricing starts at $10/day, $49/week or $149/month.</p></article>
        <article><h2>🌎 Daily Weedo Sponsor</h2><p>Reserve the clearly labeled Daily presented-by placement for a day, week or month. The shared Daily location remains deterministic and independent of sponsorship. Introductory pricing starts at $15/day, $79/week or $249/month.</p></article>
        <article><h2>🌿 Sponsored Weedo Hunt</h2><p>Run a clearly branded Hunt campaign that can grow into regional events, promotions and redemption-based challenges. Normal Hunt target selection remains independent. Introductory pricing starts at $99/week or $299/month.</p></article>
        <article><h2>Target the right area</h2><p>Game campaigns can be organized for all players or stored against country, state/province, city/region or a radius around the sponsor location, giving GeoWeedo a foundation for increasingly local campaigns.</p></article>
        <article><h2>Know what people use</h2><p>The Sponsor Dashboard tracks map impressions, pin clicks, listing views, website/menu/directions actions, game impressions and game completions over the last 30 days, including daily activity trends and an activity breakdown.</p></article>
        <article><h2>Gameplay stays fair</h2><p>Featured and presented-by sponsorship never increase a dispensary's odds of becoming a Classic, Daily or normal Hunt target. Sponsored campaigns are visibly labeled and kept separate from selection logic.</p></article>
        <article><h2>USD sponsorship billing</h2><p>Commercial sponsorships are denominated in U.S. dollars and kept separate from GeoWeedo player rewards and wallet accounting. YERB is not used for sponsorship payments.</p></article>
      </section>
    </main>
  );
}
