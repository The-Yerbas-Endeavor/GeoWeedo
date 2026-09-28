import './about.css';

export const metadata = {
  title: 'About GeoWeedo',
  description: 'Learn how GeoWeedo combines dispensary discovery, cannabis product scanning, lab data, games, owner tools, and optional YERB gameplay rewards.',
};

export default function AboutPage() {
  return (
    <main className="info-shell aboutPage">
<section className="aboutHero">
        <div className="aboutHeroCopy">
          <span className="eyebrow">ABOUT GEOWEEDO</span>
          <h1>Search. Scan. Play.</h1>
          <p>
            GeoWeedo brings cannabis discovery, product information, lab evidence, dispensary tools,
            and location-based games into one platform built around real places and real product data.
          </p>
          <div className="aboutHeroActions">
            <a className="primary" href="/">Explore GeoWeedo</a>
            <a href="/facts">Open Scanner</a>
            <a href="/product-chemistry">Browse Products</a>
          </div>
        </div>
        <img
          src="/assets/geoweedo/geoweedo-icon-master.png"
          alt=""
          aria-hidden="true"
          className="aboutHeroMascot"
        />
      </section>

      <section className="aboutMission" aria-labelledby="what-geoweedo-does">
        <div>
          <span className="eyebrow">WHAT GEOWEEDO DOES</span>
          <h2 id="what-geoweedo-does">One platform, four useful jobs.</h2>
        </div>
        <div className="aboutMissionGrid">
          <a href="/" className="aboutMissionItem">
            <b>01</b><strong>Search</strong>
            <span>Find dispensaries, products, brands, map locations, and current menu matches.</span>
          </a>
          <a href="/facts" className="aboutMissionItem">
            <b>02</b><strong>Scan</strong>
            <span>Identify packages, QR codes, barcodes, batches, UIDs, COAs, and available lab evidence.</span>
          </a>
          <a href="/how-to-play" className="aboutMissionItem">
            <b>03</b><strong>Play</strong>
            <span>Explore real dispensary locations through Classic GeoWeedo, GeoWeedo Hunt, and Daily GeoWeedo.</span>
          </a>
          <a href="/for-dispensaries" className="aboutMissionItem">
            <b>04</b><strong>Manage</strong>
            <span>Claim a dispensary, maintain public details and menus, and use optional Featured tools.</span>
          </a>
        </div>
      </section>

      <section className="aboutSections">
        <article className="aboutFeature aboutFeatureWide">
          <div>
            <span className="eyebrow">SCANNER + PRODUCTS</span>
            <h2>Product identity first. Exact batch when possible.</h2>
          </div>
          <p>
            The GeoWeedo Scanner resolves cannabis products from package identifiers and keeps the exact tested
            batch separate from the general product record. Product pages can combine batch history, cannabinoids,
            terpenes, compliance results, original source links, and current dispensary menu matches without
            pretending that one batch represents every version of a product.
          </p>
          <div className="aboutInlineLinks">
            <a href="/facts">Use the Scanner →</a>
            <a href="/product-chemistry">Browse product data →</a>
          </div>
        </article>

        <article className="aboutFeature">
          <span className="eyebrow">DISCOVERY</span>
          <h2>Real dispensaries on an interactive map</h2>
          <p>
            GeoWeedo supports location search, state browsing, Open Now filtering, product discovery,
            map layers, location detail views, and street imagery where useful coverage is available.
          </p>
        </article>

        <article className="aboutFeature">
          <span className="eyebrow">GAMES</span>
          <h2>Three ways to play GeoWeedo</h2>
          <p>
            Classic GeoWeedo is the five-round location game. GeoWeedo Hunt is a hot-and-cold search challenge.
            Daily GeoWeedo gives everyone the same daily location and shared challenge.
          </p>
        </article>

        <article className="aboutFeature">
          <span className="eyebrow">FOR DISPENSARIES</span>
          <h2>Claim, update, and measure your shop</h2>
          <p>
            Verified owners can manage their public profile, hours, amenities, products, menu pricing,
            availability, and sponsorship tools from their GeoWeedo account.
          </p>
          <a className="aboutTextLink" href="/for-dispensaries">Dispensary tools →</a>
        </article>

        <article className="aboutFeature">
          <span className="eyebrow">FEATURED</span>
          <h2>Commercial sponsorships stay separate from normal gameplay</h2>
          <p>
            Business claiming and profile management are free. Featured placement and clearly labeled sponsored
            gameplay are commercial products paid in U.S. dollars. Sponsorship does not improve a dispensary&apos;s
            odds of becoming a normal Classic, Daily, or Hunt target.
          </p>
        </article>

        <article className="aboutFeature">
          <span className="eyebrow">YERB REWARDS</span>
          <h2>Optional player rewards, not a sponsorship currency</h2>
          <p>
            Eligible gameplay can earn YERB under GeoWeedo&apos;s current reward policy. Player rewards and wallet
            accounting are kept separate from dispensary sponsorships and other commercial business features.
          </p>
          <a className="aboutTextLink" href="/rewards">Learn about YERB rewards →</a>
        </article>

        <article className="aboutFeature">
          <span className="eyebrow">MOBILE</span>
          <h2>Built for desktop, mobile web, Android, and iOS</h2>
          <p>
            GeoWeedo&apos;s mobile work extends the production web experience with native capabilities such as
            package scanning and photo-based code recognition while keeping the same accounts and data model.
          </p>
        </article>
      </section>

      <section className="aboutPrinciples">
        <div className="aboutPrinciplesIntro">
          <span className="eyebrow">HOW WE BUILD IT</span>
          <h2>Useful data with visible provenance.</h2>
          <p>
            GeoWeedo combines public, regulatory, laboratory, dispensary, and user-contributed information.
            Sources are kept distinct so a menu listing, a public reference record, and a verified lab batch do not
            silently become the same thing.
          </p>
        </div>
        <div className="aboutPrincipleList">
          <div><strong>Source-aware</strong><span>Original reports and provenance are retained when available.</span></div>
          <div><strong>Batch-aware</strong><span>Exact tested batches are separated from product-level estimates.</span></div>
          <div><strong>Open map stack</strong><span>MapLibre and open mapping sources avoid dependence on Google Maps billing.</span></div>
          <div><strong>Consumer-friendly</strong><span>Complex product and lab records are presented in a format people can actually use.</span></div>
        </div>
      </section>

      <section className="aboutNotice">
        <div>
          <span className="eyebrow">IMPORTANT</span>
          <h2>GeoWeedo organizes information. It does not provide medical advice.</h2>
        </div>
        <p>
          Cannabis product, chemistry, availability, and business information can be incomplete, delayed, or change
          over time. GeoWeedo shows source and verification context where possible so users can judge the evidence
          for themselves.
        </p>
      </section>
    </main>
  );
}
