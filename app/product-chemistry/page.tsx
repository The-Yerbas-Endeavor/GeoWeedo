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
  description: 'Browse cannabis products by name, brand, or category. Open a product for GeoWeedo Facts, lab results, batches, COAs, and source details.',
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
  const requestedPage = Math.max(1, Number(one(query.page) || '1') || 1);
  const catalog = getProductBrowseCatalog({ q, brand, type: productCategory, sort, page: requestedPage, pageSize: 36 });
  const filtersActive = Boolean(q || brand || productCategory);
  const resultStart = catalog.matchingProducts ? (catalog.page - 1) * catalog.pageSize + 1 : 0;
  const resultEnd = Math.min(catalog.page * catalog.pageSize, catalog.matchingProducts);

  function pageHref(nextPage: number) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (brand) params.set('brand', brand);
    if (productCategory) params.set('type', productCategory);
    if (sort !== 'category') params.set('sort', sort);
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
            Browse by product, brand, or category. Open a product when you want lab results, batches, COAs, availability, and source-backed details.
          </p>
          <div className="productChemistryStats" aria-label="Product catalog totals">
            <div><strong>{catalog.totalProducts.toLocaleString()}</strong><span>Products</span></div>
            <div><strong>{catalog.categoryCount.toLocaleString()}</strong><span>Categories</span></div>
            <div><strong>{catalog.brandCount.toLocaleString()}</strong><span>Brands</span></div>
            <div><strong>{catalog.batchCount.toLocaleString()}</strong><span>Lab records</span></div>
          </div>
        </section>

        <section className="nutritionalFactsIndex productBrowseIndex" aria-labelledby="product-listings-heading">
          <div className="nutritionalFactsIndexHead">
            <div>
              <span className="weedoFactsEyebrow">PRODUCT CATALOG</span>
              <h2 id="product-listings-heading">Browse products</h2>
              <p>Start simple. Choose a product to open its GeoWeedo Facts and deeper product data.</p>
            </div>
            <span className="nutritionalFactsCount">
              {catalog.matchingProducts ? `${resultStart.toLocaleString()}–${resultEnd.toLocaleString()} of ${catalog.matchingProducts.toLocaleString()}` : '0'} {catalog.matchingProducts === 1 ? 'product' : 'products'}
              {filtersActive && catalog.matchingProducts !== catalog.totalProducts ? ` · ${catalog.totalProducts.toLocaleString()} total` : ''}
            </span>
          </div>

          <form className="productChemistryFilters productBrowseFilters" method="get" action="/product-chemistry">
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
              {filtersActive || sort !== 'category' ? <a href="/product-chemistry">Clear</a> : null}
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
                    <span className="productBrowseOpen">View product →</span>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="nutritionalFactsEmptyIndex">
              {filtersActive ? 'No products match these filters.' : 'No products are available yet.'}
            </div>
          )}

          {catalog.pageCount > 1 ? <nav className="productChemistryPagination" aria-label="Product catalog pages">
            {catalog.page > 1 ? <a href={pageHref(catalog.page - 1)}>← Previous</a> : <span />}
            <strong>Page {catalog.page.toLocaleString()} of {catalog.pageCount.toLocaleString()}</strong>
            {catalog.page < catalog.pageCount ? <a href={pageHref(catalog.page + 1)}>Next →</a> : <span />}
          </nav> : null}

          {catalog.hasCannlytics ? <div className="productChemistryAttribution">
            <strong>Data attribution.</strong> Some product records are normalized from the <a href="https://huggingface.co/datasets/cannlytics/cannabis_results" target="_blank" rel="noreferrer">Cannlytics Cannabis Results Dataset</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Detailed source and COA information is shown only after opening a product.
          </div> : null}
        </section>
      </div>
    </main>
  );
}
