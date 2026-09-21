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
  title: 'GeoWeedo Scanner | GeoWeedo',
  description: 'Scan cannabis products, understand exact-batch lab results, and connect verified product identity to dispensary availability.',
  alternates: { canonical: '/facts' },
};

export default function FactsPage() {
  return (
    <main className="landing-shell">
      <SiteHeader />
      <div className="weedoFactsPage">
        <section className="weedoScannerCockpit">
          <div className="weedoScannerHero">
            <div>
              <span className="weedoFactsKicker">🌿 SCAN → KNOW → FIND</span>
              <h1>GeoWeedo Scanner</h1>
              <p>Identify the product, exact batch, lab evidence, and where you can find it.</p>
            </div>
            <img src="/assets/geoweedo/geoweedo-icon-master.png" alt="" aria-hidden="true" />
          </div>

          <WeedoFactsNativeScanBridge />
          <WeedoFactsLookup />
        </section>

        <WeedoFactsReconstruction />

        <section className="weedoFactsRoadmap weedoScannerFlow">
          <span className="weedoFactsKicker">HOW IT WORKS</span>
          <div className="weedoScannerFlowSteps">
            <div><b>01</b><strong>Scan</strong><small>QR, barcode, UID, batch or COA</small></div>
            <div><b>02</b><strong>Match</strong><small>Resolve the canonical product and exact batch</small></div>
            <div><b>03</b><strong>Know</strong><small>Read cannabinoids, terpenes and lab evidence</small></div>
            <div><b>04</b><strong>Find</strong><small>See current dispensary listings</small></div>
          </div>
        </section>
      </div>
    </main>
  );
}
