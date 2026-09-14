import { listDispensaryMenu } from '@/lib/weedoMenus';
import styles from './DispensaryMenuPanel.module.css';

function price(value: unknown, currency = 'USD') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value) / 100); }
  catch { return `$${(Number(value) / 100).toFixed(2)}`; }
}

function factsHref(item: any) {
  if (!item.product_id) return '/geoweedo-facts';
  const base = `/product/${encodeURIComponent(item.product_id)}`;
  return item.batch_id && item.linked_batch_verified ? `${base}?batch=${encodeURIComponent(item.batch_id)}` : base;
}

function categoryGlyph(value: unknown) {
  const type = String(value || '').toLowerCase();
  if (/vape|cart|cartridge/.test(type)) return '💨';
  if (/edible|gummy|chocolate/.test(type)) return '🍬';
  if (/beverage|drink/.test(type)) return '🥤';
  if (/concentrate|resin|rosin|wax|shatter/.test(type)) return '💧';
  if (/tincture/.test(type)) return '💧';
  if (/topical|cream|balm|lotion|patch/.test(type)) return '🧴';
  if (/capsule|tablet/.test(type)) return '💊';
  if (/accessory/.test(type)) return '🧰';
  if (/pre.?roll|joint/.test(type)) return '🌿';
  if (/flower/.test(type)) return '🌿';
  return '🌱';
}

function safeSlug(value: unknown) {
  return String(value || 'other').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
}

export default function DispensaryMenuPanel({ dispensaryId }: { dispensaryId: string }) {
  const items = listDispensaryMenu(dispensaryId);
  const groups = new Map<string, { id: string; slug: string; name: string; items: any[] }>();
  for (const item of items as any[]) {
    const name = String(item.canonical_category_name || item.display_category || item.category || 'Other');
    const slug = safeSlug(item.canonical_category_slug || name);
    const key = String(item.canonical_category_id || slug);
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { id: key, slug, name, items: [item] });
  }
  const categoryGroups = [...groups.values()];

  return <section className={styles.section}>
    <div className={styles.head}>
      <div><span className={styles.eyebrow}>GEOWEEDO PRODUCTS · DISPENSARY MENU</span><h2>Current menu</h2><p>Retail listings organized by the same canonical products and product categories used throughout GeoWeedo.</p></div>
      <span className={styles.count}>{items.length} {items.length === 1 ? 'product' : 'products'} · {categoryGroups.length} {categoryGroups.length === 1 ? 'category' : 'categories'}</span>
    </div>
    {items.length === 0 ? <div className={styles.empty}>No GeoWeedo menu products have been published for this dispensary yet.</div> : <>
      <nav className={styles.categoryNav} aria-label="Menu product categories">
        {categoryGroups.map((group, index) => <a key={group.id} href={`#menu-category-${group.slug}-${index}`}><span>{categoryGlyph(group.slug)}</span>{group.name}<b>{group.items.length}</b></a>)}
      </nav>
      <div className={styles.categoryGroups}>{categoryGroups.map((group, groupIndex) => <section className={styles.categoryGroup} id={`menu-category-${group.slug}-${groupIndex}`} key={group.id}>
        <div className={styles.categoryHead}><div><span className={styles.categoryIcon}>{categoryGlyph(group.slug)}</span><div><span>PRODUCT CATEGORY</span><h3>{group.name}</h3></div></div><b>{group.items.length}</b></div>
        <div className={styles.list}>{group.items.map((item: any) => {
          const exact = Boolean(item.batch_id && item.linked_batch_verified);
          const itemPrice = price(item.price_cents, item.currency || 'USD');
          const brand = item.brand_name || item.linked_brand_name;
          const category = item.canonical_category_name || item.display_category || item.category || item.linked_product_type || group.name;
          const imageAlt = `${brand ? `${brand} ` : ''}${item.item_name}`.trim();
          const imageUrl = item.display_image_url || item.image_url;
          const image = imageUrl ? <img src={imageUrl} alt={imageAlt} loading="lazy" /> : <span className={styles.imageFallback} aria-label="Product image not available"><b>{categoryGlyph(item.canonical_category_slug || category)}</b><small>GeoWeedo</small></span>;
          const canonicalProduct = item.product_id && item.linked_product_name
            ? [item.linked_brand_name, item.linked_product_name].filter(Boolean).join(' · ')
            : null;
          return <article className={styles.item} key={item.id}>
            <div className={styles.imageColumn}>{item.product_id ? <a className={styles.imageLink} href={factsHref(item)} aria-label={`View GeoWeedo Facts for ${imageAlt}`}>{image}</a> : <div className={styles.imageLink}>{image}</div>}</div>
            <div className={styles.itemContent}>
              <div className={styles.itemHead}><div><h4>{item.item_name}</h4>{brand ? <div className={styles.brand}>{brand}</div> : null}</div>{itemPrice ? <span className={styles.price}>{itemPrice}</span> : null}</div>
              {canonicalProduct ? <a className={styles.canonicalProduct} href={factsHref(item)}><span>GEOWEEDO PRODUCT</span><strong>{canonicalProduct}</strong></a> : <div className={styles.ownerProduct}><span>OWNER-REPORTED PRODUCT</span><strong>{[brand, item.item_name].filter(Boolean).join(' · ')}</strong></div>}
              <div className={styles.meta}><span className={styles.categoryTag}>{categoryGlyph(item.canonical_category_slug || category)} {category}</span>{item.variant ? <span>{item.variant}</span> : null}{item.package_size ? <span>{item.package_size}</span> : null}<span>Inventory: {item.inventory_status || 'unknown'}</span></div>
              <div className={styles.badges}>{item.verified ? <span className={styles.badge}>✓ Verified listing</span> : <span className={styles.badge}>Reported listing</span>}{exact ? <span className={`${styles.badge} ${styles.exact}`}>✓ Exact batch linked</span> : item.product_id ? <span className={styles.badge}>✓ Canonical product linked</span> : <span className={styles.badge}>Needs product match</span>}{item.linked_batch_status ? <span className={styles.badge}>Lab status: {item.linked_batch_status}</span> : null}</div>
              <div className={styles.links}>{item.product_id ? <a href={factsHref(item)}>View GeoWeedo Facts →</a> : <a href="/geoweedo-facts">Find this product in GeoWeedo Facts →</a>}{item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer">Menu source ↗</a> : null}</div>
            </div>
          </article>;
        })}</div>
      </section>)}</div>
    </>}
  </section>;
}
