import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import WeedoFactsProductLabel from '@/components/WeedoFactsProductLabel';
import { getWeedoFactsProductListing, listWeedoFactsListings } from '@/lib/weedoFactsProduct';
import '../weedo-facts/weedo-facts.css';
import '../weedo-facts/contrast-fix.css';
import '../weedo-facts/nutrition-label.css';
import '../weedo-facts/headline-totals.css';
import './listings.css';

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

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default async function NutritionalFactsPage({ searchParams }: Props) {
  const query = await searchParams;
  const productId = one(query.product)?.trim() || '';
  const batchId = one(query.batch)?.trim() || null;
  const record = productId ? getWeedoFactsProductListing(productId, batchId) : null;
  const listings = listWeedoFactsListings();

  return (
    <main className="landing-shell">
      <SiteHeader />
      <div className="weedoFactsPage">
        <section className="weedoFactsHero">
          <span className="weedoFactsKicker">🌿 GEOWEEDO</span>
          <h1>Nutritional Facts</h1>
          <p className="weedoFactsLead">
            Browse every verified cannabis product and batch currently available as a GeoWeedo Weedo Facts listing.
          </p>
        </section>

        {productId ? (
          !record ? (
            <section className="weedoFactsEmpty">
              <strong>Nutritional Facts not found.</strong>
              <p>This product or verified batch is not available in GeoWeedo.</p>
              <a className="weedoFactsCoaLink" href="/nutritional-facts">View all Nutritional Facts →</a>
            </section>
          ) : (
            <>
              <section className="weedoFactsHero">
                <a className="nutritionalFactsBack" href="/nutritional-facts">← All Nutritional Facts</a>
                <span className="weedoFactsKicker">CANNABIS NUTRITIONAL FACTS</span>
                <h2>{record.productName}</h2>
                <p className="weedoFactsLead">
                  {[record.brandName, record.productType, record.netContents].filter(Boolean).join(' · ') || 'Cannabis product'}
                </p>
              </section>
              <WeedoFactsProductLabel record={record} />
            </>
          )
        ) : null}

        <section className="nutritionalFactsIndex" aria-labelledby="nutritional-facts-listings-heading">
          <div className="nutritionalFactsIndexHead">
            <div>
              <span className="weedoFactsEyebrow">AVAILABLE LISTINGS</span>
              <h2 id="nutritional-facts-listings-heading">All Nutritional Facts</h2>
              <p>Each listing below is backed by a verified batch record in GeoWeedo.</p>
            </div>
            <span className="nutritionalFactsCount">{listings.length} {listings.length === 1 ? 'listing' : 'listings'}</span>
          </div>

          {listings.length ? (
            <div className="nutritionalFactsList">
              {listings.map(listing => {
                const tested = formatDate(listing.testedAt);
                const identity = listing.batchNumber || listing.coaNumber || listing.batchId;
                return (
                  <a
                    key={listing.batchId}
                    className="nutritionalFactsListing"
                    href={`/nutritional-facts?product=${encodeURIComponent(listing.productId)}&batch=${encodeURIComponent(listing.batchId)}`}
                  >
                    <span>
                      <span className="nutritionalFactsName">{listing.productName}</span>
                      <span className="nutritionalFactsBrand">{listing.brandName || listing.producerName || 'Brand not reported'}</span>
                    </span>
                    <span className="nutritionalFactsMeta">
                      <span><strong>Batch / COA:</strong> {identity}</span>
                      {listing.labName ? <span><strong>Lab:</strong> {listing.labName}</span> : null}
                      {tested ? <span><strong>Tested:</strong> {tested}</span> : null}
                      <span><strong>Analytes:</strong> {listing.analyteCount}</span>
                    </span>
                    <span className="nutritionalFactsOpen">View facts →</span>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="nutritionalFactsEmptyIndex">No verified Nutritional Facts listings are available yet.</div>
          )}
        </section>
      </div>
    </main>
  );
}
