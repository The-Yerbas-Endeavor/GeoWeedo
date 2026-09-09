import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import WeedoFactsProductLabel from '@/components/WeedoFactsProductLabel';
import { getWeedoFactsProductListing } from '@/lib/weedoFactsProduct';
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const record = getWeedoFactsProductListing(id);
  if (!record) return { title: 'Product not found · GeoWeedo' };
  const brand = record.brandName ? `${record.brandName} · ` : '';
  return {
    title: `${record.productName} · Weedo Facts · GeoWeedo`,
    description: `${brand}${record.productName} cannabis product listing with GeoWeedo Weedo Facts lab information.`,
    alternates: { canonical: `/product/${encodeURIComponent(record.productId)}` },
  };
}

export default async function ProductListingPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const record = getWeedoFactsProductListing(id, one(query.batch));

  if (!record) {
    return <main className={`landing-shell ${styles.shell}`}><SiteHeader /><div className={styles.page}><a className={styles.back} href="/weedo-facts">← Weedo Facts</a><section className={styles.hero}><span>GEOWEEDO PRODUCT</span><h1>Product not found</h1><p>This product listing may have been removed or is not available in GeoWeedo yet.</p></section></div></main>;
  }

  const verifiedBatch = Boolean(record.batchId && record.source?.verified);
  const provenance = [record.labName, record.producerName].filter(Boolean).join(' · ');

  return (
    <main className={`landing-shell ${styles.shell}`}>
      <SiteHeader />
      <div className={styles.page}>
        <div className={styles.topline}>
          <a className={styles.back} href="/weedo-facts">← Scan another product</a>
          <span>GeoWeedo product intelligence</span>
        </div>

        <div className={styles.productScene}>
          <section className={styles.hero}>
            <span>GEOWEEDO · WEEDO FACTS</span>
            <h1>{record.productName}</h1>
            <p className={styles.productMeta}>{[record.brandName, record.productType, record.netContents].filter(Boolean).join(' · ') || 'Cannabis product'}</p>

            <p className={styles.editorialLead}>
              A cannabis Nutritional Facts view built from the displayed lab record — chemistry first, source attached, and batch identity kept visible.
            </p>

            <div className={styles.proofLine}>
              <span className={verifiedBatch ? styles.proofVerified : styles.proofPending}>{verifiedBatch ? 'LAB-BACKED RECORD' : 'PRODUCT RECORD'}</span>
              {provenance ? <span>{provenance}</span> : null}
            </div>

            <div className={styles.mascotMoment} aria-hidden="true">
              <div className={styles.mascotHalo} />
              <img src="/assets/geoweedo/geoweedo-icon-master.png" alt="" />
              <span>Know what’s in your weedo.</span>
            </div>
          </section>

          <div className={styles.factsStage}>
            <div className={styles.factsTab}>NUTRITIONAL-STYLE LAB VIEW</div>
            <div className={styles.factsPin} aria-hidden="true">✦</div>
            <WeedoFactsProductLabel record={record} />
          </div>
        </div>
      </div>
    </main>
  );
}
