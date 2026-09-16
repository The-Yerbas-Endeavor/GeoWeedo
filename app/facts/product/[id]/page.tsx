import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import WeedoFactsProductLabel from '@/components/WeedoFactsProductLabel';
import { getWeedoFactsProductListing } from '@/lib/weedoFactsProduct';
import { resolveCanonicalProductId } from '@/lib/productMaintenance';
import { listWeedoFactsAvailability } from '@/lib/weedoFactsAvailability';
import { getFactsRecordForBatchId } from '@/lib/weedoCore';
import productStyles from '../../../product/[id]/product.module.css';
import factsStyles from '../../facts.module.css';
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
function price(cents: number | null, currency: string) {
  if (cents === null) return null;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(cents / 100); }
  catch { return `$${(cents / 100).toFixed(2)}`; }
}
function confidenceLabel(value: string) {
  if (value === 'exact_batch') return 'Exact batch';
  if (value === 'possible_match') return 'Possible match';
  return 'Same product';
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const canonicalId = resolveCanonicalProductId(id);
  const record = getWeedoFactsProductListing(canonicalId);
  if (!record) return { title: 'Product not found · Weedo Facts' };
  return {
    title: `${record.productName} · Weedo Facts`,
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
    return <main className={`landing-shell ${productStyles.shell}`}><SiteHeader /><div className={productStyles.page}><a className={productStyles.back} href="/facts">← Weedo Facts</a><section className={productStyles.hero}><span>WEEDO FACTS</span><h1>Product not found</h1><p>This canonical product is not available in GeoWeedo.</p></section></div></main>;
  }

  const availability = listWeedoFactsAvailability(productId, record.batchId);

  return <main className={`landing-shell ${productStyles.shell}`}>
    <SiteHeader />
    <div className={productStyles.page}>
      <div className={productStyles.topline}>
        <a className={productStyles.back} href="/facts">← Scan another product</a>
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

      <section className={factsStyles.availability} aria-labelledby="find-it-heading">
        <div className={factsStyles.availabilityHead}>
          <div><span>FIND IT</span><h2 id="find-it-heading">Current dispensary listings</h2></div>
          <p>GeoWeedo keeps exact-batch evidence separate from same-product and possible menu matches so availability never implies more certainty than the source provides.</p>
        </div>
        {availability.length ? <div className={factsStyles.availabilityList}>{availability.map(item => {
          const href = item.sourceUrl || `/?dispensary=${encodeURIComponent(item.dispensary.id)}&product=${encodeURIComponent(productId)}`;
          return <a className={factsStyles.availabilityItem} key={item.menuItemId} href={href} target={item.sourceUrl ? '_blank' : undefined} rel={item.sourceUrl ? 'noreferrer' : undefined}>
            <div>
              <strong>{item.dispensary.name}</strong>
              <small>{[item.dispensary.city, item.dispensary.region, item.itemName].filter(Boolean).join(' · ')}</small>
              <span className={factsStyles.confidence}>{confidenceLabel(item.availabilityConfidence)}</span>
            </div>
            <div className={factsStyles.price}>{price(item.priceCents, item.currency) || item.inventoryStatus}</div>
          </a>;
        })}</div> : <div className={factsStyles.empty}>No active GeoWeedo menu listing is currently linked to this product.</div>}
        <p className={factsStyles.matchNote}>Exact batch = verified listing for this tested batch. Same product = product match with batch unknown. Possible match = lower-confidence menu identity that should be confirmed.</p>
      </section>
    </div>
  </main>;
}
