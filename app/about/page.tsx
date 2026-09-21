import SiteHeader from '@/components/SiteHeader';

export const metadata = { title: 'About · GeoWeedo' };

export default function AboutPage() {
  return (
    <main className="info-shell">
      <SiteHeader />

      <section className="info-hero">
        <span className="eyebrow">ABOUT GEOWEEDO</span>
        <h1 style={{fontSize:'clamp(2.2rem,4vw,3.5rem)',lineHeight:1.02,maxWidth:920}}>GeoWeedo has grown into a cannabis discovery, game and product-information platform.</h1>
        <p>GeoWeedo started as a geography game built around real dispensaries. Today it combines map-based discovery, three game modes, GeoWeedo Facts, product and lab-data tools, verified dispensary-owner workspaces, sponsorship analytics and native mobile development around one public GeoWeedo platform.</p>
        <div className="info-actions"><a className="primary" href="/">Explore the map</a><a href="/product-chemistry">Browse products</a><a href="/geoweedo-facts">GeoWeedo Facts</a></div>
      </section>

      <section className="info-grid two-col">
        <article><span className="eyebrow">PLAY</span><h2>Three GeoWeedo game modes</h2><p><strong>Classic GeoWeedo</strong> is the five-round geography game. <strong>GeoWeedo Hunt</strong> turns a real dispensary into a hot-and-cold search challenge. <strong>Daily GeoWeedo</strong> gives everyone the same daily location and one shared challenge.</p></article>

        <article><span className="eyebrow">DISCOVER</span><h2>Real dispensaries on an interactive map</h2><p>The public map supports dispensary search, product and brand search, state filtering, Open Now, map layers, browse lists, location detail cards and street imagery. GeoWeedo continues expanding and cleaning public dispensary coverage state by state.</p></article>

        <article><span className="eyebrow">FACTS</span><h2>GeoWeedo Facts and product scanning</h2><p>GeoWeedo Facts connects products, batches and laboratory data. Barcode and QR scanning can identify products and exact batches when identifiers are available, while cannabinoid, terpene and compliance data are presented in a consumer-friendly format with links back to source records and original reports when available.</p></article>

        <article><span className="eyebrow">PRODUCTS</span><h2>Canonical products and categories</h2><p>GeoWeedo now maintains a shared product taxonomy used by Products, GeoWeedo Facts, product search and dispensary menus. Product records can carry verified batches, identifiers, variants and lab history while dispensary menu listings keep retail-specific price, package and availability information separate.</p></article>

        <article><span className="eyebrow">FOR DISPENSARIES</span><h2>Claim, manage and measure your shop</h2><p>Verified owners can manage their public profile, logo, hours, amenities, menu products, categories, pricing and availability from their GeoWeedo Account. Owners also have barcode/QR menu tools and a sponsor dashboard with map, listing, website, menu and gameplay activity analytics.</p></article>

        <article><span className="eyebrow">FEATURED</span><h2>Commercial sponsorships are USD-only</h2><p>Business claiming and profile management are free. GeoWeedo Featured and clearly labeled game sponsorships are priced and managed in U.S. dollars. YERB is not used for sponsorship payments, and sponsorship never increases a dispensary&apos;s odds of becoming a normal Classic, Daily or GeoWeedo Hunt target.</p></article>

        <article><span className="eyebrow">YERBAS</span><h2>Yerbas remains a player feature</h2><p>Eligible players can use the dedicated Yerbas section of their GeoWeedo Account for YERB rewards, wallet linking, balances, deposits and withdrawals. Player rewards and wallet accounting are kept separate from commercial dispensary sponsorships.</p></article>

        <article><span className="eyebrow">MOBILE</span><h2>Android and iOS development</h2><p>GeoWeedo has a separate mobile codebase for Android and iOS. The apps use the production GeoWeedo experience while adding native capabilities such as mobile barcode scanning and photo-based code recognition. Mobile work remains an active part of the project.</p></article>

        <article><span className="eyebrow">OPEN MAP STACK</span><h2>Built without Google Maps billing</h2><p>GeoWeedo uses MapLibre with OpenStreetMap/OpenFreeMap-based mapping and curated street imagery, including KartaView coverage where suitable. Public and regulatory datasets are imported with source/provenance information rather than hiding where records came from.</p></article>

        <article><span className="eyebrow">CURRENT FOCUS</span><h2>Where development is headed now</h2><p>Current work is centered on expanding dispensary and lab-data coverage safely, improving product matching and duplicate cleanup, strengthening owner menu tools, polishing mobile play and scanning, and keeping large background data imports from affecting the live site.</p></article>
      </section>

      <section className="info-grid two-col">
        <article><h2>Gameplay stays fair</h2><p>Sponsored visibility is clearly labeled and kept separate from normal game-target selection. Scoring still depends on the player&apos;s guess and the actual location.</p></article>
        <article><h2>Facts, not medical advice</h2><p>GeoWeedo can organize chemistry, product and laboratory information, but it does not predict individual effects or make medical claims. Source data can be incomplete or change, so provenance and original reports matter.</p></article>
      </section>
    </main>
  );
}
