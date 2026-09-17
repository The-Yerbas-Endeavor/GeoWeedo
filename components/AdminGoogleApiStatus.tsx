'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import styles from './AdminGoogleApiStatus.module.css';

type Row = { usage_date: string; provider: string; request_type: string; request_count: number };
type Cost = {
  sku: string;
  currency: string;
  freeMonthlyEvents: number;
  usdPer1000: number;
  monthEvents: number;
  monthRows: Array<{ usage_date: string; request_count: number }>;
  allowancePct: number;
  remainingFreeEvents: number;
  billableEvents: number;
  estimatedMonthCostUsd: number;
  projectedMonthEvents: number;
  projectedMonthCostUsd: number;
  warningLevel: number;
  warningThresholds: number[];
  billingMonthUtc: string;
  isEstimate: boolean;
};
type Status = {
  days: number;
  provider: string;
  envDefault: string;
  mapsKeyConfigured: boolean;
  placesAvailable: boolean;
  placesKeySource: 'dedicated' | 'maps-fallback' | 'missing';
  usage: {
    rows: Row[];
    googleToday: number;
    googleImagesToday: number;
    googleMetadataToday: number;
    googlePanoramasToday: number;
  };
  cost: Cost;
  accounting: { includesGoogleBilling: boolean; note: string };
};

const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value);

function Card({ label, value, note, warn = false }: { label: string; value: string; note?: string; warn?: boolean }) {
  return <article className={`${styles.metric} ${warn ? styles.metricWarn : ''}`}>
    <div className={styles.metricLabel}>{label}</div>
    <strong className={styles.metricValue}>{value}</strong>
    {note ? <div className={styles.metricNote}>{note}</div> : null}
  </article>;
}

export default function AdminGoogleApiStatus() {
  const pathname = usePathname();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (pathname !== '/admin/analytics') return;
    setError('');
    fetch(`/api/admin/google-api-status?days=${days}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) {
          location.href = '/admin/login';
          return null;
        }
        if (!response.ok) throw new Error(body.error || 'Could not load Google API status.');
        return body;
      })
      .then(value => { if (value) setData(value); })
      .catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load Google API status.'));
  }, [days, pathname]);

  const chart = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { panorama: number; images: number; metadata: number }>();
    for (const row of data.usage.rows) {
      if (row.provider !== 'google') continue;
      const value = map.get(row.usage_date) || { panorama: 0, images: 0, metadata: 0 };
      const count = Number(row.request_count || 0);
      if (row.request_type === 'panorama') value.panorama += count;
      else if (row.request_type === 'image') value.images += count;
      else if (row.request_type === 'metadata') value.metadata += count;
      map.set(row.usage_date, value);
    }
    const rows = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const max = Math.max(1, ...rows.map(([, value]) => value.panorama));
    return rows.map(([date, value]) => ({ date, ...value, pct: value.panorama / max * 100 }));
  }, [data]);

  if (pathname !== '/admin/analytics') return null;

  const cost = data?.cost;

  return <div className={styles.shell}>
    <div className={styles.header}>
      <div>
        <span className={styles.eyebrow}>GOOGLE MAPS PLATFORM</span>
        <h2>Usage & projected cost</h2>
        <p>GeoWeedo-observed Dynamic Street View usage and estimated monthly cost.</p>
      </div>
      <div className={styles.range}>
        {[1, 7, 30, 90].map(value => <button key={value} type="button" className={days === value ? styles.active : undefined} onClick={() => setDays(value)}>{value === 1 ? 'Today' : `${value}d`}</button>)}
      </div>
    </div>

    {error ? <p className={styles.error}>{error}</p> : !data || !cost ? <p className={styles.state}>Loading Google usage…</p> : <>
      <div className={styles.notice}>
        <strong>GEOWEEDO ESTIMATE — NOT GOOGLE BILLING</strong><br />
        Costs apply the configured public pay-as-you-go estimate to panorama objects recorded by GeoWeedo. Google Cloud remains authoritative for invoices, credits, quotas, and billing adjustments.
      </div>

      <div className={styles.metricGrid}>
        <Card label="PANORAMAS TODAY" value={data.usage.googlePanoramasToday.toLocaleString()} note="Dynamic Street View objects instantiated" />
        <Card label="BILLING MONTH" value={cost.monthEvents.toLocaleString()} note={`${cost.billingMonthUtc} · GeoWeedo counter`} />
        <Card label="FREE ALLOWANCE" value={`${Math.min(100, cost.allowancePct).toFixed(1)}%`} note={`${cost.remainingFreeEvents.toLocaleString()} of ${cost.freeMonthlyEvents.toLocaleString()} free events remaining`} warn={cost.warningLevel >= 75} />
        <Card label="EST. COST THIS MONTH" value={money(cost.estimatedMonthCostUsd)} note={`${cost.billableEvents.toLocaleString()} estimated billable events`} warn={cost.estimatedMonthCostUsd > 0} />
        <Card label="PROJECTED MONTH-END" value={money(cost.projectedMonthCostUsd)} note={`${cost.projectedMonthEvents.toLocaleString()} projected panorama loads`} warn={cost.projectedMonthCostUsd > 0} />
        <Card label="PAY-AS-YOU-GO RATE" value={`$${cost.usdPer1000.toFixed(2)}/1K`} note={`${cost.sku} after ${cost.freeMonthlyEvents.toLocaleString()} free monthly events`} />
      </div>

      <article className={styles.card}>
        <div className={styles.cardHead}>
          <div><h3>Dynamic Street View panorama loads</h3><p>Each bar is a GeoWeedo-recorded panorama initialization.</p></div>
          <div className={styles.selectedRange}>Selected range: {days === 1 ? 'Today' : `${days} days`}</div>
        </div>
        <div className={styles.bars}>
          {chart.length ? chart.map(row => <div key={row.date} className={styles.barRow}>
            <span>{row.date}</span>
            <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${row.pct}%` }} /></div>
            <strong>{row.panorama}</strong>
          </div>) : <div className={styles.state}>No panorama initializations recorded in this range yet.</div>}
        </div>
      </article>

      <article className={styles.card}>
        <strong>Free-allowance warnings</strong>
        <div className={styles.warningGrid}>
          {cost.warningThresholds.map(threshold => <div key={threshold} className={`${styles.warning} ${cost.allowancePct >= threshold ? styles.warningActive : ''}`}>{threshold}%</div>)}
        </div>
        <p className={styles.warningNote}>{cost.warningLevel ? `GeoWeedo has crossed the ${cost.warningLevel}% warning level.` : 'No free-allowance warning threshold has been crossed.'}</p>
      </article>

      <div className={styles.accounting}>{data.accounting.note}</div>
    </>}
  </div>;
}
