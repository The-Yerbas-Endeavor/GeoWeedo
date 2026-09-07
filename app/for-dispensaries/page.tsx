import SiteHeader from '@/components/SiteHeader';

export const metadata = { title: 'For Dispensaries · GeoWeedo' };

export default function ForDispensariesPage() {
  return (
    <main className="info-shell">
      <SiteHeader />
      <section className="info-hero">
        <span className="eyebrow">FOR DISPENSARIES</span>
        <h1>Claim your storefront. Then make it stand out.</h1>
        <p>Claiming a GeoWeedo business listing is free. Verified owners can keep their public profile accurate and optionally upgrade to GeoWeedo Featured for enhanced map visibility and sponsor analytics.</p>
        <div className="info-actions"><a className="primary" href="/">Find & claim your listing</a><a href="/owner">Owner dashboard</a></div>
      </section>
      <section className="info-grid two-col">
        <article><h2>1. Claim your business — free</h2><p>Open your dispensary listing, choose Claim this business, and submit business contact information for verification. Approved owners can manage their profile without paying for promotion.</p></article>
        <article><h2>2. Manage your listing</h2><p>Verified owners can update their overview, phone, website, hours, amenities, social links, logo and storefront information from the GeoWeedo owner workspace.</p></article>
        <article><h2>★ GeoWeedo Featured</h2><p>Featured listings receive distinctive treatment through the normal GeoWeedo pointy-pin map system plus enhanced discovery visibility and sponsor analytics. Introductory plan: $39/month or $390/year.</p></article>
        <article><h2>Know what people use</h2><p>The Sponsor Dashboard tracks map impressions, pin clicks, listing views, website/menu/directions actions and game appearances over the last 30 days.</p></article>
        <article><h2>Gameplay stays fair</h2><p>Featured status does not increase a dispensary's odds of appearing in Classic GeoWeedo, Daily Weedo or Weedo Hunt. Explicitly sponsored challenges can be introduced later as clearly labeled products.</p></article>
        <article><h2>USD sponsorship billing</h2><p>Commercial sponsorships are denominated in U.S. dollars and kept separate from GeoWeedo player rewards and wallet accounting. YERB is not used for sponsorship payments.</p></article>
      </section>
    </main>
  );
}
