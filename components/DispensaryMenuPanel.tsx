import { listDispensaryMenu } from '@/lib/weedoMenus';
import styles from './DispensaryMenuPanel.module.css';

function price(value: unknown, currency = 'USD') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value) / 100); }
  catch { return `$${(Number(value) / 100).toFixed(2)}`; }
}

function factsHref(item: any) {
  if (item.linked_uid) return `/api/weedo-facts/lookup?identifier=${encodeURIComponent(item.linked_uid)}&type=uid`;
  if (item.linked_batch_number) return `/api/weedo-facts/lookup?identifier=${encodeURIComponent(item.linked_batch_number)}&type=batch`;
  return '/weedo-facts';
}

export default function DispensaryMenuPanel({ dispensaryId }: { dispensaryId: string }) {
  const items = listDispensaryMenu(dispensaryId);
  return <section className={styles.section}>
    <div className={styles.head}>
      <div><span className={styles.eyebrow}>WEEDO FACTS · MENU</span><h2>Current menu</h2><p>Menu listings linked to GeoWeedo products and tested batches.</p></div>
      <span className={styles.count}>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
    </div>
    {items.length === 0 ? <div className={styles.empty}>No GeoWeedo-linked menu items have been published for this dispensary yet.</div> : <div className={styles.list}>{items.map((item: any) => {
      const exact = Boolean(item.batch_id && item.linked_batch_verified);
      const itemPrice = price(item.price_cents, item.currency || 'USD');
      return <article className={styles.item} key={item.id}>
        <div className={styles.itemHead}><div><h3>{item.item_name}</h3>{(item.brand_name || item.linked_brand_name) ? <div className={styles.brand}>{item.brand_name || item.linked_brand_name}</div> : null}</div>{itemPrice ? <span className={styles.price}>{itemPrice}</span> : null}</div>
        <div className={styles.meta}>{item.category ? <span>{item.category}</span> : null}{item.variant ? <span>{item.variant}</span> : null}{item.package_size ? <span>{item.package_size}</span> : null}<span>Inventory: {item.inventory_status || 'unknown'}</span></div>
        <div className={styles.badges}>{item.verified ? <span className={styles.badge}>✓ Verified listing</span> : <span className={styles.badge}>Reported listing</span>}{exact ? <span className={`${styles.badge} ${styles.exact}`}>✓ Exact batch linked</span> : item.product_id ? <span className={styles.badge}>Product linked</span> : null}{item.linked_batch_status ? <span className={styles.badge}>Lab status: {item.linked_batch_status}</span> : null}</div>
        <div className={styles.links}>{item.product_id ? <a href={factsHref(item)} target="_blank" rel="noreferrer">Open Weedo Facts →</a> : <a href="/weedo-facts">Search Weedo Facts →</a>}{item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer">Menu source ↗</a> : null}</div>
      </article>;
    })}</div>}
  </section>;
}
