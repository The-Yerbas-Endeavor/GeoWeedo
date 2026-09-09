import SiteHeader from '@/components/SiteHeader';
import WeedoFactsLookup from '../../components/WeedoFactsLookup';
import './weedo-facts.css';
import './coa-upload.css';

export const metadata = {
  title: 'Weedo Facts | GeoWeedo',
  description: 'Scan cannabis products and understand batch-level lab results in a consumer-friendly format.',
};

export default function WeedoFactsPage() {
  return (
    <main className="landing-shell">
      <SiteHeader />
      <div className="weedoFactsPage">
        <section className="weedoFactsHero">
          <span className="weedoFactsKicker">🌿 GEOWEEDO PRODUCT INTELLIGENCE</span>
          <h1>Weedo Facts</h1>
          <p className="weedoFactsLead">
            Scan a cannabis package or paste its QR, barcode, UID, batch, or COA identifier. GeoWeedo separates product identity from the exact tested batch and presents the available lab data in a consumer-friendly format.
          </p>
          <div className="weedoFactsPrinciples">
            <span>✓ Exact-batch first</span>
            <span>✓ Original COA linked</span>
            <span>✓ Lab data stays free</span>
            <span>✓ No effect or medical claims</span>
          </div>
        </section>

        <WeedoFactsLookup />

        <section className="weedoFactsRoadmap">
          <h2>How a scan is resolved</h2>
          <ol>
            <li><strong>Identify:</strong> scan QR/UPC when supported, or paste a UID, batch/lot, COA number, or lab URL.</li>
            <li><strong>Match:</strong> keep product-level identity separate from the exact tested batch.</li>
            <li><strong>Verify:</strong> prefer licensed-lab or original COA sources and clearly label unverified community data.</li>
            <li><strong>Normalize:</strong> cannabinoids, terpenes, compliance analytes, dates, lab, producer, and batch metadata.</li>
            <li><strong>Present:</strong> show a consistent Weedo Facts panel while preserving the original lab/COA source.</li>
          </ol>
        </section>
      </div>
    </main>
  );
}
