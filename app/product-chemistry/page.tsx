import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import WeedoFactsProductLabel from '@/components/WeedoFactsProductLabel';
import { getCultivarLinksForProduct } from '@/lib/kannapedia';
import { getProductBrowseCatalog } from '@/lib/productBrowse';
import { getWeedoFactsProductListing } from '@/lib/weedoFactsProduct';
import '../weedo-facts/weedo-facts.css';
import '../weedo-facts/contrast-fix.css';
import '../weedo-facts/nutrition-label.css';
import '../weedo-facts/headline-totals.css';
import './listings.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cannabis Products · GeoWeedo',
  description: 'Browse cannabis products GeoWeedo has actually matched from scans and approved COA uploads, with lab facts and dispensary availability.',
};

type Props = {
  searchParams: Promise<{
    product?: string | string[];
    batch?: string | string[];
    q?: string | string[];
    brand?: string | string[];
    type?: string | string[];
    sort?: string | string[];
    page?: string | string[];
    view?: string | string[];
  }>;
};

function one(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function displayType(value: string | null) {
  if (!value) return null;
  return value.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

const PRODUCT_SORTS = new Set(['category', 'name-asc', 'name-desc', 'brand-asc', 'recent', 'batches-desc']);

export default async function ProductChemistryPage({ searchParams }: Props) {
  const query = await searchParams;
  const productId = one(query.product)?.trim() || '';
  const batchId = one(query.batch)?.trim() || null;

  if (productId) {
    const record = getWeedoFactsProductListing(productId, batchId);
    const cultivarLinks = record?.productId ? getCultivarLinksForProduct(record.productId) : [];
    return (
      <main className="landing-shell">
        <SiteHeader />
        <div className="weedoFactsPage productChemistryPage">
          {!record ? (
            <section className="weedoFactsEmpty">
              <strong>Product not found.</strong>
              <p>This product or batch is not available in GeoWeedo.</p>
              <a className="weedoFactsCoaLink" href="/product-chemistry">← Browse products</a>
            </section>
          ) : (
            <>
              <section className="weedoFactsHero productChemistryDetailHero">
                <a className="nutritionalFactsBack" href={`/product/${encodeURIComponent(record.productId)}`}>← Product overview</a>
                <span className="weedoFactsKicker">DETAILED PRODUCT DATA</span>
                <h1>{record.productName}</h1>
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
          )}
        </div>
      </main>
    );
  }

  const q = one(query.q)?.trim() || '';
  const brand = one(query.brand)?.trim() || '';
  const productCategory = one(query.type)?.trim() || '';
  const requestedSort = one(query.sort)?.trim() || 'category';
  const sort = PRODUCT_SORTS.has(requestedSort) ? requestedSort : 'category';
  const view = one(query.view)?.trim() === 'all' ? 'all' : 'evidence';
  const requestedPage = Math.max(1, Number(one(query.page) || '1') || 1);
  const catalog = getProductBrowseCatalog({ q, brand, type: productCategory, sort, page: requestedPage, pageSize: 36, scope: view });
  const filtersActive = Boolean(q || brand || productCategory);
  const resultStart = catalog.matchingProducts ? (catalog.page - 1) * catalog.pageSize + 1 : 0;
  const resultEnd = Math.min(catalog.page * catalog.pageSize, catalog.matchingProducts);

  function pageHref(nextPage: number) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (brand) params.set('brand', brand);
    if (productCategory) params.set('type', productCategory);
    if (sort !== 'category') params.set('sort', sort);
    if (view === 'all') params.set('view', 'all');
    if (nextPage > 1) params.set('page', String(nextPage));
    const queryString = params.toString();
    return `/product-chemistry${queryString ? `?${queryString}` : ''}`;
  }

  return (
    <main className="landing-shell">
      <SiteHeader />
      <div className="weedoFactsPage productChemistryPage">
        <section className="weedoFactsHero productBrowseHero">
          <span className="weedoFactsKicker">🌿 GEOWEEDO</span>
          <h1>Products</h1>
          <p className="weedoFactsLead">
            Scanned and approved-uploaded products are shown by default. You can also switch to All products to browse GeoWeedo's complete public reference catalog.
          </p>
          <div className="productChemistryStats" aria-label="GeoWeedo product evidence totals">
            <div><strong>{catalog.scannedProducts.toLocaleString()}</strong><span>Scanned</span></div>
            <div><strong>{catalog.uploadedProducts.toLocaleString()}</strong><span>COA uploads</span></div>
            <div><strong>{catalog.allProducts.toLocaleString()}</strong><span>All products</span></div>
            <div><strong>{catalog.menuLinkedProducts.toLocaleString()}</strong><span>At dispensaries</span></div>
          </div>
        </section>

        <section className="nutritionalFactsIndex productBrowseIndex" aria-labelledby="product-listings-heading">
          <div className="productBrowseModeSwitch" aria-label="Product catalog view">
            <a className={view==='evidence'?'active':''} href="/product-chemistry">Scanned &amp; uploaded</a>
            <a className={view==='all'?'active':''} href="/product-chemistry?view=all">All products</a>
          </div>
          <div className="nutritionalFactsIndexHead">
            <div>
              <span className="weedoFactsEyebrow">{view==='all'?'ALL PRODUCTS':'SEEN BY GEOWEEDO'}</span>
              <h2 id="product-listings-heading">{view==='all'?'Complete product catalog':'Scanned & uploaded products'}</h2>
              <p>{view==='all'
                ? 'Browse the complete public GeoWeedo product library, including COA, state-imported, Cannlytics, and other reference records.'
                : 'Default view: products GeoWeedo has matched from real scans or approved COA uploads.'}</p>
            </div>
            <span className="nutritionalFactsCount">
              {catalog.matchingProducts ? `${resultStart.toLocaleString()}–${resultEnd.toLocaleString()} of ${catalog.matchingProducts.toLocaleString()}` : '0'} {catalog.matchingProducts === 1 ? 'product' : 'products'}
              {filtersActive && catalog.matchingProducts !== catalog.totalProducts ? ` · ${catalog.totalProducts.toLocaleString()} in this view` : ''}
            </span>
          </div>

          <form className="productChemistryFilters productBrowseFilters" method="get" action="/product-chemistry">
            {view==='all'?<input type="hidden" name="view" value="all"/>:null}
            <label className="productChemistrySearch">
              <span>Search products</span>
              <input name="q" defaultValue={q} placeholder="Product or brand…" />
            </label>
            <label>
              <span>Brand</span>
              <select name="brand" defaultValue={brand}>
                <option value="">All brands</option>
                {catalog.brands.map(value => <option value={value} key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Category</span>
              <select name="type" defaultValue={productCategory}>
                <option value="">All categories</option>
                {catalog.productCategories.map(category => <option value={category.slug} key={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select name="sort" defaultValue={sort}>
                <option value="category">Category · Product A–Z</option>
                <option value="name-asc">Product name A–Z</option>
                <option value="name-desc">Product name Z–A</option>
                <option value="brand-asc">Brand A–Z</option>
                <option value="recent">Newest lab record</option>
                <option value="batches-desc">Most verified batches</option>
              </select>
            </label>
            <div className="productChemistryFilterActions">
              <button type="submit">Apply</button>
              {filtersActive || sort !== 'category' ? <a href={view==='all'?'/product-chemistry?view=all':'/product-chemistry'}>Clear</a> : null}
            </div>
          </form>

          {catalog.products.length ? (
            <div className="productBrowseGrid">
              {catalog.products.map(product => {
                const secondary = [displayType(product.canonicalProductType) || product.productType, product.netContents].filter(Boolean).join(' · ');
                return (
                  <a key={product.productId} className="productBrowseCard" href={`/product/${encodeURIComponent(product.productId)}`}>
                    <div className="productBrowseCardTop">
                      <span className="productBrowseCategory">{product.categoryName || 'Other'}</span>
                    </div>
                    <strong className="productBrowseName">{product.productName}</strong>
                    <span className="productBrowseBrand">{product.brandName || 'Brand not reported'}</span>
                    {secondary ? <span className="productBrowseSecondary">{secondary}</span> : null}
                    <div className="productBrowseEvidence">
                      {product.scanCount > 0 ? <span>✓ Scanned{product.scanCount > 1 ? ` ${product.scanCount.toLocaleString()} times` : ''}</span> : null}
                      {product.approvedUploadCount > 0 ? <span>✓ Approved COA upload</span> : null}
                      {view==='all' && product.scanCount===0 && product.approvedUploadCount===0 ? <span>Reference library product</span> : null}
                      {product.verifiedBatchCount > 0 ? <span>✓ {product.verifiedBatchCount.toLocaleString()} verified {product.verifiedBatchCount === 1 ? 'batch' : 'batches'}</span> : null}
                      {product.menuListingCount > 0
                        ? <span className="productBrowseAvailable">Found at {product.menuListingCount.toLocaleString()} {product.menuListingCount === 1 ? 'dispensary listing' : 'dispensary listings'}</span>
                        : <span className="productBrowseUnavailable">No current menu match</span>}
                    </div>
                    <span className="productBrowseOpen">View GeoWeedo Facts →</span>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="nutritionalFactsEmptyIndex">
              {filtersActive
                ? `No ${view==='all'?'products':'scanned or uploaded products'} match these filters.`
                : view==='all'?'No products are available yet.':'No scanned or approved-upload products are available yet.'}
            </div>
          )}

          {catalog.pageCount > 1 ? <nav className="productChemistryPagination" aria-label="Product catalog pages">
            {catalog.page > 1 ? <a href={pageHref(catalog.page - 1)}>← Previous</a> : <span />}
            <strong>Page {catalog.page.toLocaleString()} of {catalog.pageCount.toLocaleString()}</strong>
            {catalog.page < catalog.pageCount ? <a href={pageHref(catalog.page + 1)}>Next →</a> : <span />}
          </nav> : null}

          {catalog.hasCannlytics ? <div className="productChemistryAttribution">
            <strong>Reference-data attribution.</strong> GeoWeedo may use the <a href="https://huggingface.co/datasets/cannlytics/cannabis_results" target="_blank" rel="noreferrer">Cannlytics Cannabis Results Dataset</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>, to help resolve and enrich products. Reference-only records appear when the public <strong>All products</strong> view is selected; the default view remains scanned and approved-uploaded products.
          </div> : null}
        </section>
      </div>
    </main>
  );
}
