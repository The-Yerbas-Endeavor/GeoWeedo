import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SiteHeader from '@/components/SiteHeader';
import WeedoFactsProductLabel from '@/components/WeedoFactsProductLabel';
import { getWeedoFactsProductListing } from '@/lib/weedoFactsProduct';
import { resolveCanonicalProductId } from '@/lib/productMaintenance';
import { getProductCultivars } from '@/lib/cultivarPublic';
import { getProductCategorySummary } from '@/lib/productCategoryPublic';
import styles from './product.module.css';
import '../../weedo-facts/weedo-facts.css';
import '../../weedo-facts/contrast-fix.css';
import '../../weedo-facts/nutrition-label.css';
import '../../weedo-facts/headline-totals.css';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ batch?: string | string[] }>;
};

function one(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function evidenceLabel(value: unknown) {
  return String(value || '').replace(/_/g, ' ');
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const canonicalId = resolveCanonicalProductId(id);
  const record = getWeedoFactsProductListing(canonicalId);
  if (!record) return { title: 'Product not found · GeoWeedo' };
  const brand = record.brandName ? `${record.brandName} · ` : '';
  return {
    title: `${record.productName} · GeoWeedo Facts`,
    description: `${brand}${record.productName} cannabis product listing with GeoWeedo Facts lab information.`,
    alternates: { canonical: `/product/${encodeURIComponent(record.productId)}` },
  };
}

export default async function ProductListingPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const canonicalId = resolveCanonicalProductId(id);
  const requestedBatch = one(query.batch);

  if (requestedBatch) {
    redirect(`/product-chemistry?product=${encodeURIComponent(canonicalId)}&batch=${encodeURIComponent(requestedBatch)}`);
  }
  if (canonicalId && canonicalId !== id) {
    redirect(`/product/${encodeURIComponent(canonicalId)}`);
  }

  const record = getWeedoFactsProductListing(canonicalId);

  if (!record) {
    return <main className={`landing-shell ${styles.shell}`}><SiteHeader /><div className={styles.page}><a className={styles.back} href="/geoweedo-facts">← GeoWeedo Facts</a><section className={styles.hero}><span>GEOWEEDO PRODUCT</span><h1>Product not found</h1><p>This product listing may have been removed or is not available in GeoWeedo yet.</p></section></div></main>;
  }

  const verifiedBatch = Boolean(record.batchId && record.source?.verified);
  const provenance = [record.labName, record.producerName].filter(Boolean).join(' · ');
  const findNearbyHref = `/?product=${encodeURIComponent(record.productId)}`;
  const cultivarLinks = getProductCultivars(record.productId);
  const productCategory = getProductCategorySummary(record.productId);

  return (
    <main className={`landing-shell ${styles.shell}`}>
      <SiteHeader />
      <div className={styles.page}>
        <div className={styles.topline}>
          <a className={styles.back} href="/geoweedo-facts">← Scan another product</a>
          <span>GeoWeedo product listing</span>
        </div>

        {cultivarLinks.length ? <section className={styles.cultivarLinks} aria-label="Cultivar genetics">
          <div className={styles.cultivarHeading}><span>CULTIVAR GENETICS</span><h2>Linked cultivar{cultivarLinks.length === 1 ? '' : 's'}</h2><p>Pedigree identity is kept separate from the exact batch chemistry shown below.</p></div>
          <div className={styles.cultivarList}>{cultivarLinks.map((link: any) => <a key={link.id} href={`/cultivar/${encodeURIComponent(link.slug)}`} className={styles.cultivarCard}><div><strong>{link.canonical_name}</strong><span>{[link.breeder,link.cultivar_type].filter(Boolean).join(' · ') || 'Cannabis cultivar'}</span></div><div><b>{Math.round(Number(link.confidence || 0))}%</b><small>{evidenceLabel(link.link_status)}</small></div></a>)}</div>
        </section> : null}

        <section className={styles.factsFocus} aria-labelledby="geoweedo-facts-heading">
          <div className={styles.factsHeading}>
            <span>PRODUCT CHEMISTRY</span>
            <h1 id="geoweedo-facts-heading">GeoWeedo Facts</h1>
            <p>The lab-backed cannabis chemistry for this product is the primary content of this listing.</p>
          </div>

          <div className={styles.proofLine}>
            <span className={verifiedBatch ? styles.proofVerified : styles.proofPending}>{verifiedBatch ? 'VERIFIED LAB RECORD' : 'PRODUCT RECORD'}</span>
            {productCategory ? <a className={styles.categoryLink} href={`/product-chemistry?type=${encodeURIComponent(productCategory.slug)}`}>{productCategory.name}</a> : null}
            {provenance ? <span>{provenance}</span> : null}
          </div>

          <div className={styles.availabilityAction}>
            <a className={styles.findNearby} href={findNearbyHref}>📍 Find this product near me</a>
            <small>Shows dispensaries with an active GeoWeedo menu listing for this exact product.</small>
          </div>

          <div className={styles.factsStage} id="geoweedo-facts-label">
            <WeedoFactsProductLabel record={record} />
          </div>
        </section>
      </div>
    </main>
  );
}
