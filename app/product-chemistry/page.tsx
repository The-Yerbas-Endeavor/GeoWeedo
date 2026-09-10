import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import WeedoFactsProductLabel from '@/components/WeedoFactsProductLabel';
import { getCultivarLinksForProduct } from '@/lib/kannapedia';
import { getProductChemistryCatalog, getWeedoFactsProductListing } from '@/lib/weedoFactsProduct';
import '../weedo-facts/weedo-facts.css';
import '../weedo-facts/contrast-fix.css';
import '../weedo-facts/nutrition-label.css';
import '../weedo-facts/headline-totals.css';
import './listings.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cannabis Product Chemistry · GeoWeedo',
  description: 'Search GeoWeedo Product Chemistry by product, consumer brand, licensed business, product type, batch, COA, and lab data.',
};

type Props = {
  searchParams: Promise<{
    product?: string | string[];
    batch?: string | string[];
    q?: string | string[];
    brand?: string | string[];
    business?: string | string[];
    type?: string | string[];
    page?: string | string[];
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

export default async function ProductChemistryPage({ searchParams }: Props) {
  const query = await searchParams;
  const productId = one(query.product)?.trim() || '';
  const batchId = one(query.batch)?.trim() || null;
  const q = one(query.q)?.trim() || '';
  const brand = one(query.brand)?.trim() || '';
  const business = one(query.business)?.trim() || '';
  const productType = one(query.type)?.trim() || '';
  const requestedPage = Math.max(1, Number(one(query.page) || '1') || 1);
  const record = productId ? getWeedoFactsProductListing(productId, batchId) : null;
  const cultivarLinks = record?.productId ? getCultivarLinksForProduct(record.productId) : [];
  const catalog = getProductChemistryCatalog({ q, brand, business, type: productType, page: requestedPage, pageSize: 50 });
  const filtersActive = Boolean(q || brand || business || productType);
  const resultStart = catalog.matchingListings ? (catalog.page - 1) * catalog.pageSize + 1 : 0;
  const resultEnd = Math.min(catalog.page * catalog.pageSize, catalog.matchingListings);

  function pageHref(nextPage: number) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (brand) params.set('brand', brand);
    if (business) params.set('business', business);
    if (productType) params.set('type', productType);
    if (nextPage > 1) params.set('page', String(nextPage));
    const queryString = params.toString();
    return `/product-chemistry${queryString ? `?${queryString}` : ''}`;
  }

  return (
    <main className="landing-shell">
      <SiteHeader />
      <div className="weedoFactsPage productChemistryPage">
        <section className="weedoFactsHero">
          <span className="weedoFactsKicker">🌿 GEOWEEDO</span>
          <h1>Product Chemistry</h1>
          <p className="weedoFactsLead">
            Search verified cannabis product and batch chemistry by product, consumer brand, licensed business, product type, batch, COA, or laboratory data.
          </p>
          <div className="productChemistryStats" aria-label="Product Chemistry catalog totals">
            <div><strong>{catalog.productCount.toLocaleString()}</strong><span>Products</span></div>
            <div><strong>{catalog.totalListings.toLocaleString()}</strong><span>Verified batches</span></div>
            <div><strong>{catalog.brandCount.toLocaleString()}</strong><span>Consumer brands</span></div>
            <div><strong>{catalog.businessCount.toLocaleString()}</strong><span>Licensed businesses</span></div>
          </div>
        </section>

        {productId ? (
          !record ? (
            <section className="weedoFactsEmpty">
              <strong>Product Chemistry not found.</strong>
              <p>This product or verified batch is not available in GeoWeedo.</p>
              <a className="weedoFactsCoaLink" href="/product-chemistry">View all Product Chemistry →</a>
            </section>
          ) : (
            <>
              <section className="weedoFactsHero productChemistryDetailHero">
                <a className="nutritionalFactsBack" href="/product-chemistry">← All Product Chemistry</a>
                <span className="weedoFactsKicker">CANNABIS PRODUCT CHEMISTRY</span>
                <h2>{record.productName}</h2>
                <p className="weedoFactsLead">
                  {[record.brandName, record.productType, record.netContents].filter(Boolean).join(' · ') || 'Cannabis product'}
                </p>
                {cultivarLinks.length ? <div className="productChemistryCultivarLinks">
                  <strong>Cultivar Genetics:</strong>
                  {cultivarLinks.map((link: any) => <a key={link.rsp_id} href={`/cultivars/${encodeURIComponent(link.rsp_id)}`}>{link.name}{link.registrant ? ` · ${link.registrant}` : ''} →</a>)}
                </div> : null}
              </section>
              <WeedoFactsProductLabel record={record} />
            </>
          )
        ) : null}

        <section className="nutritionalFactsIndex" aria-labelledby="product-chemistry-listings-heading">
          <div className="nutritionalFactsIndexHead">
            <div>
              <span className="weedoFactsEyebrow">VERIFIED CATALOG</span>
              <h2 id="product-chemistry-listings-heading">Product Chemistry catalog</h2>
              <p>Consumer brand and licensed business are kept as separate identities. Every result below is backed by a verified batch record with source provenance.</p>
            </div>
            <span className="nutritionalFactsCount">
              {catalog.matchingListings ? `${resultStart.toLocaleString()}–${resultEnd.toLocaleString()} of ${catalog.matchingListings.toLocaleString()}` : '0'} {catalog.matchingListings === 1 ? 'batch' : 'batches'}
              {filtersActive && catalog.matchingListings !== catalog.totalListings ? ` · ${catalog.totalListings.toLocaleString()} total` : ''}
            </span>
          </div>

          <form className="productChemistryFilters" method="get" action="/product-chemistry">
            <label className="productChemistrySearch">
              <span>Search catalog</span>
              <input name="q" defaultValue={q} placeholder="Product, batch, COA, brand, business, license…" />
            </label>
            <label>
              <span>Consumer brand</span>
              <select name="brand" defaultValue={brand}>
                <option value="">All brands</option>
                {catalog.brands.map(value => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Licensed business</span>
              <select name="business" defaultValue={business}>
                <option value="">All businesses</option>
                {catalog.businesses.map(value => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Product type</span>
              <select name="type" defaultValue={productType}>
                <option value="">All types</option>
                {catalog.productTypes.map(value => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <div className="productChemistryFilterActions">
              <button type="submit">Search</button>
              {filtersActive ? <a href="/product-chemistry">Clear</a> : null}
            </div>
          </form>

          {catalog.listings.length ? (
            <div className="nutritionalFactsList">
              {catalog.listings.map(listing => {
                const tested = formatDate(listing.testedAt);
                const identity = listing.batchNumber || listing.coaNumber || listing.batchId;
                return (
                  <a
                    key={listing.batchId}
                    className="nutritionalFactsListing productChemistryListing"
                    href={`/product-chemistry?product=${encodeURIComponent(listing.productId)}&batch=${encodeURIComponent(listing.batchId)}`}
                  >
                    <span className="productChemistryIdentity">
                      <span className="nutritionalFactsName">{listing.productName}</span>
                      <span className="nutritionalFactsBrand">
                        <strong>Consumer brand:</strong> {listing.brandName || 'Not reported'}
                      </span>
                      <span className="productChemistryBusiness">
                        <strong>Licensed business:</strong> {listing.producerName || 'Not reported'}
                        {listing.producerLicenseNumber ? ` · ${listing.producerLicenseNumber}` : ''}
                      </span>
                    </span>
                    <span className="nutritionalFactsMeta">
                      {listing.productType ? <span><strong>Type:</strong> {listing.productType}</span> : null}
                      <span><strong>Batch / COA:</strong> {identity}</span>
                      {listing.labName ? <span><strong>Lab:</strong> {listing.labName}</span> : null}
                      {tested ? <span><strong>Tested:</strong> {tested}</span> : null}
                      {listing.sourceName ? <span><strong>Source:</strong> {listing.sourceName}{listing.sourceName === 'Cannlytics' ? ' · normalized public dataset' : ''}</span> : null}
                      <span><strong>Analytes:</strong> {listing.analyteCount}</span>
                    </span>
                    <span className="nutritionalFactsOpen">View chemistry →</span>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="nutritionalFactsEmptyIndex">
              {filtersActive ? 'No verified Product Chemistry listings match these filters.' : 'No verified Product Chemistry listings are available yet.'}
            </div>
          )}

          {catalog.pageCount > 1 ? <nav className="productChemistryPagination" aria-label="Product Chemistry pages">
            {catalog.page > 1 ? <a href={pageHref(catalog.page - 1)}>← Previous</a> : <span />}
            <strong>Page {catalog.page.toLocaleString()} of {catalog.pageCount.toLocaleString()}</strong>
            {catalog.page < catalog.pageCount ? <a href={pageHref(catalog.page + 1)}>Next →</a> : <span />}
          </nav> : null}

          {catalog.hasCannlytics ? <div className="productChemistryAttribution">
            <strong>Cannlytics attribution.</strong> Some Product Chemistry records are normalized from the <a href="https://huggingface.co/datasets/cannlytics/cannabis_results" target="_blank" rel="noreferrer">Cannlytics Cannabis Results Dataset</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. GeoWeedo normalizes field names, product identities, and analyte naming; original source or COA links are retained when supplied by the dataset.
          </div> : null}
        </section>
      </div>
    </main>
  );
}
