import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SiteHeader from '@/components/SiteHeader';
import WeedoFactsProductLabel from '@/components/WeedoFactsProductLabel';
import { getWeedoFactsProductListing } from '@/lib/weedoFactsProduct';
import { getProductCultivars } from '@/lib/cultivarPublic';
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
  const record = getWeedoFactsProductListing(id);
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
  const requestedBatch = one(query.batch);

  if (requestedBatch) {
    redirect(`/product-chemistry?product=${encodeURIComponent(id)}&batch=${encodeURIComponent(requestedBatch)}`);
  }

  const record = getWeedoFactsProductListing(id);

  if (!record) {
    return <main className={`landing-shell ${styles.shell}`}><SiteHeader /><div className={styles.page}><a className={styles.back} href="/geoweedo-facts">← GeoWeedo Facts</a><section className={styles.hero}><span>GEOWEEDO PRODUCT</span><h1>Product not found</h1><p>This product listing may have been removed or is not available in GeoWeedo yet.</p></section></div></main>;
  }

  const verifiedBatch = Boolean(record.batchId && record.source?.verified);
  const provenance = [record.labName, record.producerName].filter(Boolean).join(' · ');
  const findNearbyHref = `/?product=${encodeURIComponent(record.productId)}`;
  const cultivarLinks = getProductCultivars(record.productId);

  return (
    <main className={`landing-shell ${styles.shell}`}>
      <SiteHeader />
      <div className={styles.page}>
        <div className={styles.topline}>
          <a className={styles.back} href="/geoweedo-facts">← Scan another product</a>
          <span>GeoWeedo product listing</span>
        </div>

        <section className={styles.productIntro}>
          <span>GEOWEEDO · PRODUCT CHEMISTRY</span>
          <h1>{record.productName}</h1>
          <p>{[record.brandName, record.productType, record.netContents].filter(Boolean).join(' · ') || 'Cannabis product'}</p>
          <div className={styles.proofLine}>
            <span className={verifiedBatch ? styles.proofVerified : styles.proofPending}>{verifiedBatch ? 'VERIFIED LAB RECORD' : 'PRODUCT RECORD'}</span>
            {provenance ? <span>{provenance}</span> : null}
          </div>
          <div className={styles.availabilityAction}>
            <a className={styles.findNearby} href={findNearbyHref}>📍 Find this product near me</a>
            <small>Shows dispensaries with an active GeoWeedo menu listing for this exact product.</small>
          </div>
        </section>

        {cultivarLinks.length ? <section className={styles.cultivarLinks} aria-label="Cultivar genetics">
          <div className={styles.cultivarHeading}><span>CULTIVAR GENETICS</span><h2>Linked cultivar{cultivarLinks.length === 1 ? '' : 's'}</h2><p>Pedigree identity is kept separate from the exact batch chemistry shown below.</p></div>
          <div className={styles.cultivarList}>{cultivarLinks.map((link: any) => <a key={link.id} href={`/cultivar/${encodeURIComponent(link.slug)}`} className={styles.cultivarCard}><div><strong>{link.canonical_name}</strong><span>{[link.breeder,link.cultivar_type].filter(Boolean).join(' · ') || 'Cannabis cultivar'}</span></div><div><b>{Math.round(Number(link.confidence || 0))}%</b><small>{evidenceLabel(link.link_status)}</small></div></a>)}</div>
        </section> : null}

        <section className={styles.factsFocus} aria-labelledby="geoweedo-facts-heading">
          <div className={styles.factsHeading}>
            <span>PRODUCT CHEMISTRY</span>
            <h2 id="geoweedo-facts-heading">GeoWeedo Facts</h2>
            <p>The lab-backed cannabis chemistry for this product is the primary content of this listing.</p>
          </div>

          <div className={styles.factsStage} id="geoweedo-facts-label">
            <WeedoFactsProductLabel record={record} />
          </div>
        </section>
      </div>
    </main>
  );
}
