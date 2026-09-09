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
          A free, consumer-friendly view of cannabis product and batch lab information. The goal is simple: scan the package, match the exact batch, and make the original Certificate of Analysis easier to understand.
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
        <h2>Scanner pipeline</h2>
        <ol>
          <li><strong>Identify:</strong> lab QR, UPC/barcode, California UID, batch/lot, or COA number.</li>
          <li><strong>Match:</strong> separate product-level identity from the exact tested batch.</li>
          <li><strong>Verify:</strong> prefer licensed-lab or original COA sources; clearly label community submissions.</li>
          <li><strong>Normalize:</strong> cannabinoids, terpenes, compliance analytes, dates, lab, producer, and batch metadata.</li>
          <li><strong>Present:</strong> show a consistent Weedo Facts panel while preserving a link to the original COA.</li>
        </ol>
      </section>
    </main>
  );
}
