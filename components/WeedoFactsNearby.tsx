'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import styles from './WeedoFactsNearby.module.css';

type Confidence = 'exact_batch' | 'same_product' | 'possible_match';
type AvailabilityItem = {
  menuItemId: string;
  availabilityConfidence: Confidence;
  itemName: string;
  brandName: string | null;
  packageSize: string | null;
  priceCents: number | null;
  currency: string;
  inventoryStatus: string;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  batchNumber: string | null;
  dispensary: {
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
  };
};
type AvailabilityResponse = { count: number; exactBatchCount: number; items: AvailabilityItem[] };
type Coordinates = { latitude: number; longitude: number };
type RankedItem = AvailabilityItem & { distanceMiles: number };

const nearbyMiles = 100;

function haversineMiles(a: Coordinates, b: Coordinates) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const earthMiles = 3958.7613;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthMiles * Math.asin(Math.min(1, Math.sqrt(h)));
}

function money(cents: number | null, currency: string) {
  if (cents === null || !Number.isFinite(cents)) return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function ageLabel(value: string | null) {
  if (!value) return 'Menu freshness unknown';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Menu freshness unknown';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 2) return 'Menu updated just now';
  if (minutes < 60) return `Menu updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Menu updated ${hours}h ago`;
  return `Menu updated ${Math.round(hours / 24)}d ago`;
}

function confidenceLabel(value: Confidence) {
  if (value === 'exact_batch') return 'Exact batch';
  if (value === 'same_product') return 'Same product';
  return 'Possible match';
}

function confidenceNote(value: Confidence) {
  if (value === 'exact_batch') return 'The menu listing is linked to this verified tested batch.';
  if (value === 'same_product') return 'The dispensary lists this product, but GeoWeedo cannot confirm the current batch.';
  return 'Brand/product matching suggests this may be the same product; verify with the dispensary.';
}

function inventoryLabel(value: string) {
  const normalized = String(value || 'unknown').replaceAll('_', ' ').trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Availability unknown';
}

export default function WeedoFactsNearby({ productId, batchId, productName }: { productId: string; batchId?: string | null; productName?: string | null }) {
  const [zip, setZip] = useState('');
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [items, setItems] = useState<AvailabilityItem[]>([]);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setOrigin(null);
    setLocationLabel('');
    setItems([]);
    setError('');
  }, [productId, batchId]);

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    setLoadingResults(true);
    setError('');
    const params = new URLSearchParams({ productId });
    if (batchId) params.set('batchId', batchId);
    fetch(`/api/weedo-facts/availability?${params.toString()}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Could not check nearby dispensaries.');
        return body as AvailabilityResponse;
      })
      .then(body => { if (!cancelled) setItems(Array.isArray(body.items) ? body.items : []); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not check nearby dispensaries.'); })
      .finally(() => { if (!cancelled) setLoadingResults(false); });
    return () => { cancelled = true; };
  }, [origin, productId, batchId]);

  const ranked = useMemo<RankedItem[]>(() => {
    if (!origin) return [];
    return items.flatMap(item => {
      const latitude = Number(item.dispensary.latitude);
      const longitude = Number(item.dispensary.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      return [{ ...item, distanceMiles: haversineMiles(origin, { latitude, longitude }) }];
    }).sort((a, b) => a.distanceMiles - b.distanceMiles);
  }, [items, origin]);

  const nearby = ranked.filter(item => item.distanceMiles <= nearbyMiles).slice(0, 8);
  const shown = nearby.length ? nearby : ranked.slice(0, 5);

  function useCurrentLocation() {
    setError('');
    if (!navigator.geolocation) {
      setError('This browser cannot provide your location. Enter a ZIP code instead.');
      return;
    }
    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        setOrigin({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocationLabel('Your current location');
        setLoadingLocation(false);
      },
      () => {
        setError('Location was not available. Enter a ZIP code instead.');
        setLoadingLocation(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function useZip(event: FormEvent) {
    event.preventDefault();
    const value = zip.trim();
    if (!/^\d{5}(?:-\d{4})?$/.test(value)) {
      setError('Enter a valid 5-digit ZIP code.');
      return;
    }
    setLoadingLocation(true);
    setError('');
    try {
      const response = await fetch(`/api/zip-lookup?zip=${encodeURIComponent(value)}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'ZIP lookup failed.');
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('Coordinates are unavailable for this ZIP code.');
      setOrigin({ latitude, longitude });
      setLocationLabel([body.city, body.region, body.zip].filter(Boolean).join(', '));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ZIP lookup failed.');
    } finally {
      setLoadingLocation(false);
    }
  }

  const productLabel = String(productName || '').trim();

  return <section className={styles.shell}>
    <div className={styles.head}>
      <div><span>FIND THIS PRODUCT</span><h3>{productLabel ? `Find ${productLabel} nearby` : 'Find this product nearby'}</h3><p>GeoWeedo checks current menu records after showing the confirmed facts. Exact tested-batch matches are identified separately from same-product and possible matches.</p></div>
    </div>

    <div className={styles.locationControls}>
      <button type="button" className={styles.locationButton} onClick={useCurrentLocation} disabled={loadingLocation}>{loadingLocation ? 'Finding location…' : 'Use my location'}</button>
      <span className={styles.or}>or</span>
      <form onSubmit={useZip} className={styles.zipForm}>
        <input value={zip} onChange={event => setZip(event.target.value)} inputMode="numeric" placeholder="ZIP code" aria-label="ZIP code" />
        <button type="submit" disabled={loadingLocation}>Find nearby</button>
      </form>
    </div>

    {locationLabel ? <div className={styles.locationLabel}>Searching near <strong>{locationLabel}</strong></div> : null}
    {error ? <p className={styles.error}>{error}</p> : null}
    {loadingResults ? <p className={styles.status}>Checking dispensary menus…</p> : null}

    {origin && !loadingResults && !error ? <>
      {shown.length ? <div className={styles.results}>
        {!nearby.length ? <p className={styles.notice}>No known menu matches are within {nearbyMiles} miles. These are the nearest known matches in GeoWeedo.</p> : null}
        {shown.map(item => {
          const price = money(item.priceCents, item.currency);
          return <article className={styles.result} key={item.menuItemId}>
            <div className={styles.resultTop}>
              <div><strong>{item.dispensary.name}</strong><span>{[item.dispensary.city, item.dispensary.region].filter(Boolean).join(', ') || 'Location available'}</span></div>
              <b>{item.distanceMiles < 10 ? item.distanceMiles.toFixed(1) : Math.round(item.distanceMiles)} mi</b>
            </div>
            <div className={styles.badgeRow}>
              <span className={`${styles.confidence} ${styles[item.availabilityConfidence]}`}>{confidenceLabel(item.availabilityConfidence)}</span>
              <span className={styles.inventory}>{inventoryLabel(item.inventoryStatus)}</span>
            </div>
            <p className={styles.confidenceNote}>{confidenceNote(item.availabilityConfidence)}</p>
            <div className={styles.menuLine}>
              <span>{[item.brandName, item.itemName, item.packageSize].filter(Boolean).join(' · ')}</span>
              {price ? <strong>{price}</strong> : null}
            </div>
            {item.availabilityConfidence === 'exact_batch' && item.batchNumber ? <div className={styles.batch}>Batch / lot: <strong>{item.batchNumber}</strong></div> : null}
            <div className={styles.footer}>
              <span>{ageLabel(item.sourceUpdatedAt)}</span>
              <div><Link href={`/dispensary/${encodeURIComponent(item.dispensary.id)}`}>Dispensary details →</Link>{item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">Menu source ↗</a> : null}</div>
            </div>
          </article>;
        })}
      </div> : <div className={styles.empty}><strong>No nearby menu matches yet.</strong><p>GeoWeedo has confirmed facts for this product, but does not currently have a correlated dispensary menu listing with usable coordinates. The test record remains available even when store inventory is unknown.</p></div>}
    </> : null}
  </section>;
}
