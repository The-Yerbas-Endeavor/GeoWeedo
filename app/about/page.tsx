import SiteHeader from '@/components/SiteHeader';

export const metadata = { title: 'About · GeoWeedo' };

export default function AboutPage() {
  return (
    <main className="info-shell">
      <SiteHeader />
      <section className="info-hero">
        <span className="eyebrow">ABOUT GEOWEEDO</span>
        <h1>A geography game built around real dispensaries.</h1>
        <p>GeoWeedo combines street-level exploration, map guessing and the Yerbas ecosystem. The goal is simple: make geography fun, help players discover places, and create a useful promotional channel for dispensaries.</p>
      </section>
      <section className="info-grid two-col">
        <article><h2>Open map stack</h2><p>GeoWeedo uses MapLibre, OpenFreeMap/OpenStreetMap data and curated street imagery instead of requiring Google Maps billing.</p></article>
        <article><h2>Curated locations</h2><p>Locations do not enter live games until imagery is reviewed and a fair starting frame is approved.</p></article>
        <article><h2>Yerbas utility</h2><p>Players can earn YERB for eligible skill-based play, while dispensaries can use YERB for clearly labeled priority placement.</p></article>
        <article><h2>Fair gameplay</h2><p>Sponsored placement can affect how often a business appears, but it never changes the correct location, distance calculation or score.</p></article>
      </section>
    </main>
  );
}
