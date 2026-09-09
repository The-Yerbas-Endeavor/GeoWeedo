import WeedoFactsLookup from '../../components/WeedoFactsLookup';
import './weedo-facts.css';

export const metadata = {
  title: 'Weedo Facts | GeoWeedo',
  description: 'Scan cannabis products and understand batch-level lab results in a consumer-friendly format.',
};

export default function WeedoFactsPage() {
  return (
    <main className="weedoFactsPage">
      <section className="weedoFactsHero">
        <span className="weedoFactsKicker">🌿 GEOWEEDO PRODUCT INTELLIGENCE</span>
        <h1>Weedo Facts</h1>
        <p className="weedoFactsLead">
          Scan a cannabis package, identify the product and exact batch when possible, and turn the original lab data into a clear consumer-friendly report.
        </p>
        <div className="weedoFactsPrinciples">
          <span>✓ Camera QR / barcode scan</span>
          <span>✓ Exact-batch first</span>
          <span>✓ Original COA linked</span>
          <span>✓ Lab data stays free</span>
          <span>✓ No effect or medical claims</span>
        </div>
      </section>

      <WeedoFactsLookup />

      <section className="weedoFactsRoadmap">
        <h2>How Weedo Facts resolves a scan</h2>
        <ol>
          <li><strong>Scan:</strong> read a lab QR or supported product barcode with the phone camera, or enter an identifier manually.</li>
          <li><strong>Identify:</strong> distinguish QR, UPC/barcode, California UID, batch/lot, and COA identifiers.</li>
          <li><strong>Match:</strong> keep product identity separate from the exact tested batch and never silently substitute an ambiguous batch.</li>
          <li><strong>Verify:</strong> prefer licensed-lab or original COA sources; clearly label community submissions.</li>
          <li><strong>Present:</strong> show cannabinoids, terpenes, compliance results, dates, lab, producer, and batch metadata in a consistent Weedo Facts card.</li>
        </ol>
      </section>
    </main>
  );
}
