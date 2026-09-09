'use client';

import { useEffect, useState } from 'react';

function measure(value: any) {
  if (!value || value.value === null || value.value === undefined) return '—';
  return `${Number(value.value).toLocaleString(undefined, { maximumFractionDigits: 4 })}${value.unit ? ` ${value.unit}` : ''}`;
}

function range(value: any, unit?: string | null) {
  if (!value) return '—';
  const min = Number(value.min).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const max = Number(value.max).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const text = min === max ? min : `${min}–${max}`;
  return unit ? `${text} ${unit}` : text;
}

export default function WeedoFactsBatchHistory({ productId, currentBatchId }: { productId: string; currentBatchId?: string | null }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    fetch(`/api/weedo-facts/history?productId=${encodeURIComponent(productId)}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || 'Unable to load batch history.');
        if (!cancelled) setData(body);
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load batch history.'); });
    return () => { cancelled = true; };
  }, [productId]);

  if (error) return <section className="weedoFactsBatchHistory"><h3>Batch history</h3><p className="weedoFactsError">{error}</p></section>;
  if (!data) return <section className="weedoFactsBatchHistory"><h3>Batch history</h3><p>Loading verified batches…</p></section>;

  const summary = data.summary || {};
  const batches = Array.isArray(data.batches) ? data.batches : [];
  return <section className="weedoFactsBatchHistory">
    <div className="weedoFactsBatchHistoryHead">
      <div><h3>Batch history</h3><p>Verified lab history for this product. Different batches can test differently.</p></div>
      <strong>{summary.verifiedBatchCount || 0} verified {summary.verifiedBatchCount === 1 ? 'batch' : 'batches'}</strong>
    </div>

    {batches.length ? <>
      <div className="weedoFactsBatchSummary">
        <div><span>THC range</span><strong>{range(summary.thcRange, summary.thcUnit)}</strong></div>
        <div><span>Terpene range</span><strong>{range(summary.terpeneRange, summary.terpeneUnit)}</strong></div>
        <div><span>Recurring dominant terpenes</span><strong>{summary.dominantTerpenes?.length ? summary.dominantTerpenes.map((row: any) => row.name).join(', ') : '—'}</strong></div>
      </div>
      <div className="weedoFactsBatchHistoryList">
        {batches.map((batch: any) => {
          const lookupIdentifier = batch.uid || batch.coa_number || batch.batch_number;
          const lookupType = batch.uid ? 'uid' : batch.coa_number ? 'coa' : 'batch';
          const current = batch.id === currentBatchId;
          return <article className={`weedoFactsBatchHistoryItem ${current ? 'current' : ''}`} key={batch.id}>
            <div className="weedoFactsBatchHistoryTitle">
              <strong>{batch.batch_number || batch.coa_number || batch.uid || 'Verified batch'}</strong>
              {current ? <span>Current scan</span> : null}
            </div>
            <div className="weedoFactsBatchHistoryMeta">
              <span>{batch.tested_at ? `Tested ${new Date(batch.tested_at).toLocaleDateString()}` : 'Test date unavailable'}</span>
              <span>{batch.lab_name || batch.source_name || 'Verified lab source'}</span>
              {batch.overall_status ? <span>Lab status: {batch.overall_status}</span> : null}
            </div>
            <div className="weedoFactsBatchHistoryMeasures">
              <span>THC <strong>{measure(batch.totalThc)}</strong></span>
              <span>Terpenes <strong>{measure(batch.terpeneTotal)}</strong></span>
              <span>Dominant <strong>{batch.dominantTerpenes?.length ? batch.dominantTerpenes.map((row: any) => row.name).join(', ') : '—'}</strong></span>
            </div>
            <div className="weedoFactsBatchHistoryLinks">
              {lookupIdentifier ? <a href={`/api/weedo-facts/lookup?identifier=${encodeURIComponent(lookupIdentifier)}&type=${lookupType}`} target="_blank" rel="noreferrer">Open batch lookup →</a> : null}
              {batch.coa_url ? <a href={batch.coa_url} target="_blank" rel="noreferrer">Original COA ↗</a> : null}
            </div>
          </article>;
        })}
      </div>
    </> : <p>No verified historical batches are available yet.</p>}
  </section>;
}
