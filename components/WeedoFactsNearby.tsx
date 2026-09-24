'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ProductSightingReporter from '@/components/ProductSightingReporter';
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
  sourceType?: string;
  evidenceType?: 'owner_verified' | 'current_listed' | 'scanner_sighting' | 'user_sighting' | 'brand_distribution' | 'historical';
  evidenceLabel?: string;
  observedAt?: string | null;
  historical?: boolean;
  batchNumber: string | null;
  verified?: boolean;
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
type RankedItem = AvailabilityItem & { distanceMiles: number | null; listingCount: number };

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
  if (!value) return 'Freshness unknown';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Freshness unknown';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 2) return 'Observed just now';
  if (minutes < 60) return `Observed ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Observed ${hours}h ago`;
  return `Observed ${Math.round(hours / 24)}d ago`;
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

function confidenceRank(value: Confidence) {
  if (value === 'exact_batch') return 0;
  if (value === 'same_product') return 1;
  return 2;
}

function evidenceRank(value: AvailabilityItem['evidenceType']) {
  if (value === 'owner_verified') return 0;
  if (value === 'current_listed') return 1;
  if (value === 'scanner_sighting') return 2;
  if (value === 'user_sighting') return 3;
  if (value === 'brand_distribution') return 4;
  if (value === 'historical') return 6;
  return 5;
}

function evidenceNote(item: AvailabilityItem) {
  if (item.evidenceType === 'owner_verified') return 'The dispensary or verified owner confirmed this product.';
  if (item.evidenceType === 'current_listed') return 'GeoWeedo recently observed this product on a dispensary menu.';
  if (item.evidenceType === 'scanner_sighting') return 'A GeoWeedo user recently scanned this product at this dispensary.';
  if (item.evidenceType === 'user_sighting') return 'A GeoWeedo user recently reported seeing this product here.';
  if (item.evidenceType === 'brand_distribution') return 'The brand reported that this dispensary carries the product.';
  if (item.evidenceType === 'historical') return 'This is older evidence and should not be treated as current inventory.';
  return confidenceNote(item.availabilityConfidence);
}

function sourceTime(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function WeedoFactsNearby({ productId, batchId, productName, scanId }: { productId: string; batchId?: string | null; productName?: string | null; scanId?: string | null }) {
  const [zip, setZip] = useState('');
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [items, setItems] = useState<AvailabilityItem[]>([]);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingResults(true);
    setError('');
    setItems([]);

    const params = new URLSearchParams({ productId });
    if (batchId) params.set('batchId', batchId);

    fetch(`/api/weedo-facts/availability?${params.toString()}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Could not check dispensary listings.');
        return body as AvailabilityResponse;
      })
      .then(body => { if (!cancelled) setItems(Array.isArray(body.items) ? body.items : []); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not check dispensary listings.'); })
      .finally(() => { if (!cancelled) setLoadingResults(false); });

    return () => { cancelled = true; };
  }, [productId, batchId, refreshToken]);

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ productId?: string }>).detail;
      if (!detail?.productId || detail.productId === productId) setRefreshToken(value => value + 1);
    };
    window.addEventListener('geoweedo:availability-updated', onUpdated as EventListener);
    return () => window.removeEventListener('geoweedo:availability-updated', onUpdated as EventListener);
  }, [productId]);

  const storeItems = useMemo(() => {
    const grouped = new Map<string, { item: AvailabilityItem; count: number }>();

    for (const item of items) {
      const key = item.dispensary.id;
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, { item, count: 1 });
        continue;
      }

      current.count += 1;
      const currentHistorical = Boolean(current.item.historical);
      const nextHistorical = Boolean(item.historical);
      const currentEvidence = evidenceRank(current.item.evidenceType);
      const nextEvidence = evidenceRank(item.evidenceType);
      const currentRank = confidenceRank(current.item.availabilityConfidence);
      const nextRank = confidenceRank(item.availabilityConfidence);
      const stronger =
        (currentHistorical && !nextHistorical) ||
        (currentHistorical === nextHistorical && nextEvidence < currentEvidence) ||
        (currentHistorical === nextHistorical && nextEvidence === currentEvidence && nextRank < currentRank) ||
        (currentHistorical === nextHistorical && nextEvidence === currentEvidence && nextRank === currentRank && sourceTime(item.sourceUpdatedAt) > sourceTime(current.item.sourceUpdatedAt));

      if (stronger) current.item = item;
    }

    return Array.from(grouped.values()).map(({ item, count }) => ({ ...item, listingCount: count }));
  }, [items]);

  const ranked = useMemo<RankedItem[]>(() => {
    const rows = storeItems.map(item => {
      const latitude = item.dispensary.latitude === null ? Number.NaN : Number(item.dispensary.latitude);
      const longitude = item.dispensary.longitude === null ? Number.NaN : Number(item.dispensary.longitude);
      const distanceMiles = origin && Number.isFinite(latitude) && Number.isFinite(longitude)
        ? haversineMiles(origin, { latitude, longitude })
        : null;
      return { ...item, distanceMiles };
    });

    return rows.sort((a, b) => {
      if (Boolean(a.historical) !== Boolean(b.historical)) return Number(Boolean(a.historical)) - Number(Boolean(b.historical));
      if (origin) {
        if (a.distanceMiles !== null && b.distanceMiles !== null) return a.distanceMiles - b.distanceMiles;
        if (a.distanceMiles !== null) return -1;
        if (b.distanceMiles !== null) return 1;
      }

      const evidence = evidenceRank(a.evidenceType) - evidenceRank(b.evidenceType);
      if (evidence) return evidence;
      const confidence = confidenceRank(a.availabilityConfidence) - confidenceRank(b.availabilityConfidence);
      if (confidence) return confidence;
      return a.dispensary.name.localeCompare(b.dispensary.name);
    });
  }, [storeItems, origin]);

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
        setLocationLabel('your current location');
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
  const storeCount = ranked.length;
  const currentCount = ranked.filter(item => !item.historical).length;
  const historicalCount = storeCount - currentCount;

  return <section className={styles.shell}>
    <div className={styles.head}>
      <div>
        <span>FIND THIS PRODUCT</span>
        <h3>{productLabel ? `Find ${productLabel}` : 'Find this product'}</h3>
        <p>GeoWeedo combines dispensary confirmations, recent public listings, package scans, and user sightings. Older evidence stays visible as history instead of being presented as live inventory.</p>
      </div>
    </div>

    {loadingResults ? <p className={styles.status}>Checking availability evidence…</p> : null}

    {!loadingResults && !error && storeCount ? <div className={styles.summary}>
      <strong>{currentCount.toLocaleString()} current {currentCount === 1 ? 'location' : 'locations'}</strong>
      <span>{historicalCount ? `${historicalCount.toLocaleString()} historical · ` : ''}{origin ? `sorted closest to ${locationLabel || 'your selected location'}` : 'use location or ZIP to sort by distance'}</span>
    </div> : null}

    <div className={styles.locationControls}>
      <button type="button" className={styles.locationButton} onClick={useCurrentLocation} disabled={loadingLocation}>{loadingLocation ? 'Finding location…' : origin && locationLabel === 'your current location' ? 'Update my location' : 'Use my location'}</button>
      <span className={styles.or}>or</span>
      <form onSubmit={useZip} className={styles.zipForm}>
        <input value={zip} onChange={event => setZip(event.target.value)} inputMode="numeric" placeholder="ZIP code" aria-label="ZIP code" />
        <button type="submit" disabled={loadingLocation}>{loadingLocation ? 'Finding…' : 'Sort by ZIP'}</button>
      </form>
    </div>

    {locationLabel && origin ? <div className={styles.locationLabel}>Sorted nearest to <strong>{locationLabel}</strong></div> : null}
    {error ? <p className={styles.error}>{error}</p> : null}

    {!loadingResults && !error ? <>
      {ranked.length ? <div className={styles.results}>
        {ranked.map(item => {
          const price = money(item.priceCents, item.currency);
          const place = [item.dispensary.city, item.dispensary.region].filter(Boolean).join(', ') || 'Location details pending';
          return <article className={`${styles.result} ${item.historical ? styles.historical : ''}`} key={item.dispensary.id}>
            <div className={styles.resultTop}>
              <div>
                <strong>{item.dispensary.name}</strong>
                <span>{place}{item.listingCount > 1 ? ` · ${item.listingCount} evidence records` : ''}</span>
              </div>
              {origin ? <b className={item.distanceMiles === null ? styles.distanceUnknown : undefined}>{item.distanceMiles === null ? 'Distance unavailable' : item.distanceMiles < 10 ? `${item.distanceMiles.toFixed(1)} mi` : `${Math.round(item.distanceMiles)} mi`}</b> : null}
            </div>
            <div className={styles.badgeRow}>
              {item.evidenceLabel ? <span className={styles.evidence}>{item.evidenceLabel}</span> : null}
              <span className={`${styles.confidence} ${styles[item.availabilityConfidence]}`}>{confidenceLabel(item.availabilityConfidence)}</span>
              <span className={styles.inventory}>{inventoryLabel(item.inventoryStatus)}</span>
            </div>
            <p className={styles.confidenceNote}>{evidenceNote(item)}</p>
            <div className={styles.menuLine}>
              <span>{[item.brandName, item.itemName, item.packageSize].filter(Boolean).join(' · ')}</span>
              {price ? <strong>{price}</strong> : null}
            </div>
            {item.availabilityConfidence === 'exact_batch' && item.batchNumber ? <div className={styles.batch}>Batch / lot: <strong>{item.batchNumber}</strong></div> : null}
            <div className={styles.footer}>
              <span>{ageLabel(item.observedAt || item.sourceUpdatedAt)}</span>
              <div>
                <Link href={`/dispensary/${encodeURIComponent(item.dispensary.id)}`}>Dispensary details →</Link>
                {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a> : null}
              </div>
            </div>
          </article>;
        })}
      </div> : <div className={styles.empty}>
        <strong>No availability evidence yet.</strong>
        <p>GeoWeedo knows the product, but nobody has linked it to a dispensary yet. An owner confirmation, public menu observation, package scan, or user sighting can create that connection.</p>
      </div>}
    </> : null}

    {scanId ? <ProductSightingReporter productId={productId} batchId={batchId} scanId={scanId} /> : null}
  </section>;
}
