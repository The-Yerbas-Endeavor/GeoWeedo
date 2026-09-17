'use client';

import { useEffect, useMemo, useState } from 'react';

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
  return <article style={{
    padding: 16,
    border: `1px solid ${warn ? 'rgba(245,196,81,.45)' : 'rgba(255,255,255,.09)'}`,
    borderRadius: 15,
    background: warn ? 'rgba(245,196,81,.055)' : '#131815',
    minHeight: 118,
  }}>
    <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.11em', color: warn ? '#f5c451' : '#67d66e' }}>{label}</div>
    <strong style={{ display: 'block', fontSize: 24, marginTop: 9 }}>{value}</strong>
    {note ? <div style={{ marginTop: 7, color: '#9aa69d', fontSize: 11, lineHeight: 1.45 }}>{note}</div> : null}
  </article>;
}

export default function AdminGoogleApiStatus() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
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
  }, [days]);

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

  const cost = data?.cost;

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
      <div>
        <span style={{ color: '#67d66e', fontSize: 11, fontWeight: 900, letterSpacing: '.15em' }}>GOOGLE MAPS PLATFORM</span>
        <h2 style={{ margin: '5px 0 4px' }}>Usage & projected cost</h2>
        <p style={{ margin: 0, color: '#9aa69d', fontSize: 13 }}>GeoWeedo-observed Dynamic Street View usage and estimated monthly cost.</p>
      </div>
      <div style={{ display: 'flex', gap: 7 }}>
        {[1, 7, 30, 90].map(value => <button key={value} type="button" onClick={() => setDays(value)} style={{
          padding: '7px 10px',
          borderRadius: 8,
          border: `1px solid ${days === value ? '#67d66e' : 'rgba(255,255,255,.12)'}`,
          background: days === value ? 'rgba(103,214,110,.12)' : '#131815',
          color: '#fff',
          cursor: 'pointer',
        }}>{value === 1 ? 'Today' : `${value}d`}</button>)}
      </div>
    </div>

    {error ? <p>{error}</p> : !data || !cost ? <p>Loading Google usage…</p> : <>
      <div style={{ padding: '12px 14px', border: '1px solid rgba(245,196,81,.35)', background: 'rgba(245,196,81,.055)', borderRadius: 12, marginBottom: 12, fontSize: 12, lineHeight: 1.5 }}>
        <strong style={{ color: '#f5c451' }}>GEOWEEDO ESTIMATE — NOT GOOGLE BILLING</strong><br />
        Costs apply the configured public pay-as-you-go estimate to panorama objects recorded by GeoWeedo. Google Cloud remains authoritative for invoices, credits, quotas, and billing adjustments.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
        <Card label="PANORAMAS TODAY" value={data.usage.googlePanoramasToday.toLocaleString()} note="Dynamic Street View objects instantiated" />
        <Card label="BILLING MONTH" value={cost.monthEvents.toLocaleString()} note={`${cost.billingMonthUtc} · GeoWeedo counter`} />
        <Card label="FREE ALLOWANCE" value={`${Math.min(100, cost.allowancePct).toFixed(1)}%`} note={`${cost.remainingFreeEvents.toLocaleString()} of ${cost.freeMonthlyEvents.toLocaleString()} free events remaining`} warn={cost.warningLevel >= 75} />
        <Card label="EST. COST THIS MONTH" value={money(cost.estimatedMonthCostUsd)} note={`${cost.billableEvents.toLocaleString()} estimated billable events`} warn={cost.estimatedMonthCostUsd > 0} />
        <Card label="PROJECTED MONTH-END" value={money(cost.projectedMonthCostUsd)} note={`${cost.projectedMonthEvents.toLocaleString()} projected panorama loads`} warn={cost.projectedMonthCostUsd > 0} />
        <Card label="PAY-AS-YOU-GO RATE" value={`$${cost.usdPer1000.toFixed(2)}/1K`} note={`${cost.sku} after ${cost.freeMonthlyEvents.toLocaleString()} free monthly events`} />
      </div>

      <article style={{ marginTop: 14, padding: 18, border: '1px solid rgba(255,255,255,.09)', borderRadius: 16, background: '#131815' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div><h3 style={{ margin: 0 }}>Dynamic Street View panorama loads</h3><p style={{ margin: '5px 0 0', fontSize: 12, color: '#9aa69d' }}>Each bar is a GeoWeedo-recorded panorama initialization.</p></div>
          <div style={{ fontSize: 11, color: '#9aa69d' }}>Selected range: {days === 1 ? 'Today' : `${days} days`}</div>
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          {chart.length ? chart.map(row => <div key={row.date} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 55px', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#9aa69d' }}>{row.date}</span>
            <div style={{ height: 12, borderRadius: 999, background: 'rgba(255,255,255,.05)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${row.pct}%`, background: '#67d66e' }} /></div>
            <strong style={{ fontSize: 12, textAlign: 'right' }}>{row.panorama}</strong>
          </div>) : <div style={{ color: '#9aa69d' }}>No panorama initializations recorded in this range yet.</div>}
        </div>
      </article>

      <article style={{ marginTop: 12, padding: 16, border: '1px solid rgba(255,255,255,.09)', borderRadius: 14, background: '#101512' }}>
        <strong>Free-allowance warnings</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 7, marginTop: 10 }}>
          {cost.warningThresholds.map(threshold => <div key={threshold} style={{ padding: '10px 6px', textAlign: 'center', borderRadius: 9, border: `1px solid ${cost.allowancePct >= threshold ? '#f5c451' : 'rgba(255,255,255,.1)'}`, color: cost.allowancePct >= threshold ? '#f5c451' : '#879188', fontWeight: 800 }}>{threshold}%</div>)}
        </div>
        <p style={{ fontSize: 11, color: '#8e9a91', marginBottom: 0 }}>{cost.warningLevel ? `GeoWeedo has crossed the ${cost.warningLevel}% warning level.` : 'No free-allowance warning threshold has been crossed.'}</p>
      </article>

      <div style={{ marginTop: 12, fontSize: 11, color: '#8e9a91', lineHeight: 1.5 }}>{data.accounting.note}</div>
    </>}
  </div>;
}
