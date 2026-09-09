'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './WeedoFactsAvailability.module.css';

type AvailabilityItem = {
  id: string;
  dispensaryId: string;
  dispensaryName?: string | null;
  dispensarySlug?: string | null;
  city?: string | null;
  region?: string | null;
  itemName: string;
  brandName?: string | null;
  category?: string | null;
  variant?: string | null;
  packageSize?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  inventoryStatus?: string | null;
  sourceUrl?: string | null;
  verified?: number | boolean | null;
  productId?: string | null;
  batchId?: string | null;
  linkedBatchNumber?: string | null;
  linkedBatchVerified?: number | boolean | null;
};

type AvailabilityResponse = {
  count?: number;
  items?: AvailabilityItem[];
};

function money(cents?: number | null, currency = 'USD') {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(Number(cents) / 100);
  } catch {
    return `$${(Number(cents) / 100).toFixed(2)}`;
  }
}

function inventoryLabel(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return 'Availability not confirmed';
  if (['in_stock', 'instock', 'available', 'active'].includes(normalized)) return 'In stock';
  if (['low_stock', 'low'].includes(normalized)) return 'Low stock';
  if (['out_of_stock', 'outofstock', 'sold_out', 'unavailable'].includes(normalized)) return 'Out of stock';
  return normalized.replace(/[_-]+/g, ' ').replace(/^./, char => char.toUpperCase());
}

export default function WeedoFactsAvailability({ productId, batchId }: { productId?: string | null; batchId?: string | null }) {
  const [items, setItems] = useState<AvailabilityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (productId) params.set('productId', productId);
    if (batchId) params.set('batchId', batchId);
    return params.toString();
  }, [productId, batchId]);

  useEffect(() => {
    let cancelled = false;
    if (!query) {
      setItems([]);
      return;
    }

    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/weedo-facts/availability?${query}`, { cache: 'no-store' });
        const body = await response.json() as AvailabilityResponse & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Availability lookup failed.');
        if (!cancelled) setItems(Array.isArray(body.items) ? body.items : []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Availability lookup failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [query]);

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>WHERE TO FIND IT</span>
          <h3>Dispensary availability</h3>
        </div>
        {!loading && !error ? <strong>{items.length} {items.length === 1 ? 'listing' : 'listings'}</strong> : null}
      </div>

      {loading ? <p className={styles.muted}>Checking GeoWeedo menus…</p> : null}
      {error ? <p className={styles.muted}>Availability could not be checked right now.</p> : null}
      {!loading && !error && items.length === 0 ? (
        <div className={styles.empty}>
          <strong>No linked dispensary listings yet.</strong>
          <span>This does not mean the product is unavailable; GeoWeedo simply has not linked a current menu listing for this product or batch.</span>
        </div>
      ) : null}

      {items.length ? (
        <div className={styles.list}>
          {items.map(item => {
            const exactBatch = Boolean(batchId && item.batchId === batchId && item.linkedBatchVerified);
            const price = money(item.priceCents, item.currency || 'USD');
            const place = [item.city, item.region].filter(Boolean).join(', ');
            const dispensaryHref = item.dispensarySlug ? `/dispensary/${encodeURIComponent(item.dispensarySlug)}` : `/dispensary/${encodeURIComponent(item.dispensaryId)}`;
            return (
              <article className={styles.item} key={item.id}>
                <div className={styles.itemHead}>
                  <div>
                    <a className={styles.dispensary} href={dispensaryHref}>{item.dispensaryName || 'GeoWeedo dispensary'}</a>
                    {place ? <span className={styles.place}>{place}</span> : null}
                  </div>
                  {price ? <strong className={styles.price}>{price}</strong> : null}
                </div>
                <div className={styles.product}>{item.itemName}</div>
                <div className={styles.meta}>
                  {item.packageSize ? <span>{item.packageSize}</span> : null}
                  {item.variant ? <span>{item.variant}</span> : null}
                  {item.category ? <span>{item.category}</span> : null}
                  <span>{inventoryLabel(item.inventoryStatus)}</span>
                </div>
                <div className={styles.badges}>
                  {exactBatch ? <span className={styles.exact}>✓ Exact tested batch</span> : item.productId === productId ? <span>Product match</span> : null}
                  {item.verified ? <span>✓ Listing verified</span> : <span>Menu listing</span>}
                </div>
                <div className={styles.links}>
                  <a href={dispensaryHref}>View dispensary →</a>
                  {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">View menu source ↗</a> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
