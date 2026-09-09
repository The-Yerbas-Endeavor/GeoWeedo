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
    return <main className="landing-shell"><SiteHeader /><div className={styles.page}><a className={styles.back} href="/weedo-facts">← Weedo Facts</a><section className={styles.hero}><span>GEOWEEDO PRODUCT</span><h1>Product not found</h1><p>This product listing may have been removed or is not available in GeoWeedo yet.</p></section></div></main>;
  }

  return (
    <main className="landing-shell">
      <SiteHeader />
      <div className={styles.page}>
        <div className={styles.topline}>
          <a className={styles.back} href="/weedo-facts">← Scan or search another product</a>
          <span>GeoWeedo product listing</span>
        </div>

        <section className={styles.hero}>
          <span>GEOWEEDO · WEEDO FACTS</span>
          <h1>{record.productName}</h1>
          <p>{[record.brandName, record.productType, record.netContents].filter(Boolean).join(' · ') || 'Cannabis product'}</p>
          <div className={styles.intro}>The Nutritional Facts-style panel below is the primary product information for this GeoWeedo listing. Values come from the displayed lab record; calculated totals are explicitly labeled as calculated.</div>
        </section>

        <WeedoFactsProductLabel record={record} />
      </div>
    </main>
  );
}
