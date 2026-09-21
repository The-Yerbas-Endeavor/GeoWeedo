import SiteHeader from '@/components/SiteHeader';
import WeedoFactsLookup from '@/components/WeedoFactsLookup';
import WeedoFactsNativeScanBridge from '@/components/WeedoFactsNativeScanBridge';
import WeedoFactsReconstruction from '@/components/WeedoFactsReconstruction';
import '../geoweedo-facts/geoweedo-facts.css';
import '../geoweedo-facts/coa-upload.css';
import '../geoweedo-facts/contrast-fix.css';
import '../geoweedo-facts/nutrition-label.css';
import '../geoweedo-facts/headline-totals.css';
import '../geoweedo-facts/reconstruction.css';

export const metadata = {
  title: 'GeoWeedo Facts | GeoWeedo',
  description: 'Scan cannabis products, understand exact-batch lab results, and connect verified product identity to dispensary availability.',
  alternates: { canonical: '/facts' },
};

export default function FactsPage() {
  return (
    <main className="landing-shell">
      <SiteHeader />
      <div className="weedoFactsPage">
        <section className="weedoFactsHero">
          <span className="weedoFactsKicker">🌿 SCAN → KNOW → FIND</span>
          <h1>GeoWeedo Facts</h1>
          <p className="weedoFactsLead">
            Scan a cannabis package or paste its QR, barcode, UID, batch, or COA identifier. GeoWeedo resolves one canonical product, keeps the exact tested batch separate, and shows the available lab evidence in a consumer-friendly format.
          </p>
          <div className="weedoFactsPrinciples">
            <span>✓ Exact-batch first</span>
            <span>✓ Original COA linked</span>
            <span>✓ Match confidence shown</span>
            <span>✓ Find current listings</span>
          </div>
        </section>

        <WeedoFactsNativeScanBridge />
        <WeedoFactsLookup />
        <WeedoFactsReconstruction />

        <section className="weedoFactsRoadmap">
          <h2>One simple resolution path</h2>
          <ol>
            <li><strong>Scan:</strong> classify the QR, UPC, Retail ID, lab URL, batch, or other identifier.</li>
            <li><strong>Match:</strong> resolve it to GeoWeedo's canonical product and, when evidence supports it, the exact batch.</li>
            <li><strong>Know:</strong> normalize cannabinoids, terpenes, compliance tests, lab, producer, dates, and source provenance.</li>
            <li><strong>Find:</strong> separate exact-batch availability from same-product and possible menu matches.</li>
          </ol>
        </section>
      </div>
    </main>
  );
}
