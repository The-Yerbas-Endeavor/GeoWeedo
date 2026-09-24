import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import WeedoFactsProductLabel from '@/components/WeedoFactsProductLabel';
import { getWeedoFactsProductListing } from '@/lib/weedoFactsProduct';
import { resolveCanonicalProductId } from '@/lib/productMaintenance';
import { getFactsRecordForBatchId } from '@/lib/weedoCore';
import productStyles from '../../../product/[id]/product.module.css';
import '../../../weedo-facts/weedo-facts.css';
import '../../../weedo-facts/contrast-fix.css';
import '../../../weedo-facts/nutrition-label.css';
import '../../../weedo-facts/headline-totals.css';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ batch?: string | string[] }>;
};

function one(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const canonicalId = resolveCanonicalProductId(id);
  const record = getWeedoFactsProductListing(canonicalId);
  if (!record) return { title: 'Product not found · GeoWeedo Facts' };
  return {
    title: `${record.productName} · GeoWeedo Facts`,
    description: `${record.brandName ? `${record.brandName} · ` : ''}${record.productName} batch chemistry, testing evidence, and dispensary availability.`,
    alternates: { canonical: `/facts/product/${encodeURIComponent(canonicalId)}` },
  };
}

export default async function FactsProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const productId = resolveCanonicalProductId(id);
  const requestedBatchId = one(query.batch) || null;
  const requestedBatch = requestedBatchId ? getFactsRecordForBatchId(requestedBatchId) : null;
  const productRecord = getWeedoFactsProductListing(productId);
  const record = requestedBatch?.productId === productId ? requestedBatch : productRecord;

  if (!record) {
    return <main className={`landing-shell ${productStyles.shell}`}><SiteHeader /><div className={productStyles.page}><a className={productStyles.back} href="/product-chemistry">← Back to products</a><section className={productStyles.hero}><span>GEOWEEDO FACTS</span><h1>Product not found</h1><p>This canonical product is not available in GeoWeedo.</p></section></div></main>;
  }

  return <main className={`landing-shell ${productStyles.shell}`}>
    <SiteHeader />
    <div className={productStyles.page}>
      <div className={productStyles.topline}>
        <a className={productStyles.back} href="/product-chemistry">← Back to products</a>
        <span>Canonical GeoWeedo product</span>
      </div>

      <section className={productStyles.factsFocus} aria-labelledby="weedo-facts-heading">
        <div className={productStyles.factsHeading}>
          <span>PRODUCT</span>
          <h1 id="weedo-facts-heading">{record.brandName ? `${record.brandName} — ` : ''}{record.productName}</h1>
          <p>{record.batchId ? 'Showing source-backed batch evidence when available.' : 'Showing the canonical product record. Scan a batch or COA for exact-package evidence.'}</p>
        </div>
        <div className={productStyles.factsStage}><WeedoFactsProductLabel record={record} /></div>
      </section>

    </div>
  </main>;
}
