import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import WeedoFactsProductLabel from '@/components/WeedoFactsProductLabel';
import { getWeedoFactsProductListing } from '@/lib/weedoFactsProduct';
import '../weedo-facts/weedo-facts.css';
import '../weedo-facts/contrast-fix.css';
import '../weedo-facts/nutrition-label.css';
import '../weedo-facts/headline-totals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cannabis Nutritional Facts · GeoWeedo',
  description: 'GeoWeedo cannabis Nutritional Facts built from lab-reported product and batch data.',
};

type Props = {
  searchParams: Promise<{
    product?: string | string[];
    batch?: string | string[];
  }>;
};

function one(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NutritionalFactsPage({ searchParams }: Props) {
  const query = await searchParams;
  const productId = one(query.product)?.trim() || '';
  const batchId = one(query.batch)?.trim() || null;
  const record = productId ? getWeedoFactsProductListing(productId, batchId) : null;

  return (
    <main className="landing-shell">
      <SiteHeader />
      <div className="weedoFactsPage">
        <section className="weedoFactsHero">
          <span className="weedoFactsKicker">🌿 GEOWEEDO</span>
          <h1>Nutritional Facts</h1>
          <p className="weedoFactsLead">
            Cannabis product and batch lab results presented as a clear Weedo Facts label.
          </p>
        </section>

        {!productId ? (
          <section className="weedoFactsEmpty">
            <strong>Select a cannabis product first.</strong>
            <p>Scan or search a package in Weedo Facts, then open its Nutritional Facts page.</p>
            <a className="weedoFactsCoaLink" href="/weedo-facts">Open Weedo Facts →</a>
          </section>
        ) : !record ? (
          <section className="weedoFactsEmpty">
            <strong>Nutritional Facts not found.</strong>
            <p>This product or verified batch is not available in GeoWeedo.</p>
            <a className="weedoFactsCoaLink" href="/weedo-facts">Search another product →</a>
          </section>
        ) : (
          <>
            <section className="weedoFactsHero">
              <span className="weedoFactsKicker">CANNABIS NUTRITIONAL FACTS</span>
              <h2>{record.productName}</h2>
              <p className="weedoFactsLead">
                {[record.brandName, record.productType, record.netContents].filter(Boolean).join(' · ') || 'Cannabis product'}
              </p>
            </section>
            <WeedoFactsProductLabel record={record} />
          </>
        )}
      </div>
    </main>
  );
}
