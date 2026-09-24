'use client';

import { useEffect, useMemo, useState } from 'react';
import WeedoFactsNearby from '@/components/WeedoFactsNearby';

function measure(value: any) {
  if (!value || value.value === null || value.value === undefined) return '—';
  return `${Number(value.value).toLocaleString(undefined, { maximumFractionDigits: 4 })}${value.unit ? ` ${value.unit}` : ''}`;
}

function measureNumber(value: any) {
  if (!value || value.value === null || value.value === undefined) return Number.NEGATIVE_INFINITY;
  const number = Number(value.value);
  return Number.isFinite(number) ? number : Number.NEGATIVE_INFINITY;
}

function range(value: any, unit?: string | null) {
  if (!value) return '—';
  const min = Number(value.min).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const max = Number(value.max).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const text = min === max ? min : `${min}–${max}`;
  return unit ? `${text} ${unit}` : text;
}

function batchLabel(batch: any) {
  return String(batch?.batch_number || batch?.coa_number || batch?.uid || 'Batch evidence');
}

function testedAt(batch: any) {
  if (!batch?.tested_at) return Number.NEGATIVE_INFINITY;
  const value = new Date(batch.tested_at).getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

export default function WeedoFactsBatchHistory({ productId, currentBatchId }: { productId: string; currentBatchId?: string | null }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('newest');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    setPage(1);
    fetch(`/api/weedo-facts/history?productId=${encodeURIComponent(productId)}`, { cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || 'Unable to load batch history.');
        if (!cancelled) setData(body);
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load batch history.'); });
    return () => { cancelled = true; };
  }, [productId, currentBatchId, refreshNonce]);

  useEffect(() => {
    const refresh = () => setRefreshNonce(value => value + 1);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const batches = useMemo(() => {
    const rows = Array.isArray(data?.batches) ? [...data.batches] : [];
    rows.sort((a: any, b: any) => {
      if (sort === 'oldest') return testedAt(a) - testedAt(b) || batchLabel(a).localeCompare(batchLabel(b));
      if (sort === 'batch-asc') return batchLabel(a).localeCompare(batchLabel(b), undefined, { numeric: true, sensitivity: 'base' });
      if (sort === 'thc-desc') return measureNumber(b.totalThc) - measureNumber(a.totalThc) || testedAt(b) - testedAt(a);
      if (sort === 'terpenes-desc') return measureNumber(b.terpeneTotal) - measureNumber(a.terpeneTotal) || testedAt(b) - testedAt(a);
      return testedAt(b) - testedAt(a) || batchLabel(a).localeCompare(batchLabel(b));
    });
    return rows;
  }, [data, sort]);

  if (error) return <>
    <WeedoFactsNearby productId={productId} batchId={currentBatchId} />
    <section className="weedoFactsBatchHistory"><h3>Batch history</h3><p className="weedoFactsError">{error}</p></section>
  </>;
  if (!data) return <>
    <WeedoFactsNearby productId={productId} batchId={currentBatchId} />
    <section className="weedoFactsBatchHistory"><h3>Batch history</h3><p>Loading batch evidence…</p></section>
  </>;

  const summary = data.summary || {};
  const pageCount = Math.max(1, Math.ceil(batches.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const visibleBatches = batches.slice(start, start + pageSize);
  const rangeStart = batches.length ? start + 1 : 0;
  const rangeEnd = Math.min(start + pageSize, batches.length);

  return <>
    <WeedoFactsNearby productId={productId} batchId={currentBatchId} />
    <section className="weedoFactsBatchHistory">
      <div className="weedoFactsBatchHistoryHead">
        <div><h3>Batch history</h3><p>Batch chemistry history for this product. Verification status is shown for each batch.</p></div>
        <strong>{summary.batchCount ?? batches.length} {(summary.batchCount ?? batches.length) === 1 ? 'batch' : 'batches'} · {summary.verifiedBatchCount || 0} verified</strong>
      </div>

      {batches.length ? <>
        <div className="weedoFactsBatchSummary">
          <div><span>THC range</span><strong>{range(summary.thcRange, summary.thcUnit)}</strong></div>
          <div><span>Terpene range</span><strong>{range(summary.terpeneRange, summary.terpeneUnit)}</strong></div>
          <div><span>Recurring dominant terpenes</span><strong>{summary.dominantTerpenes?.length ? summary.dominantTerpenes.map((row: any) => row.name).join(', ') : '—'}</strong></div>
        </div>
        <div className="weedoFactsBatchControls">
          <label>Sort
            <select value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}>
              <option value="newest">Newest test first</option>
              <option value="oldest">Oldest test first</option>
              <option value="batch-asc">Batch A–Z</option>
              <option value="thc-desc">Highest THC</option>
              <option value="terpenes-desc">Highest terpenes</option>
            </select>
          </label>
          <label>Rows
            <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </label>
        </div>
        <div className="weedoFactsBatchHistoryList">
          {visibleBatches.map((batch: any) => {
            const lookupIdentifier = batch.uid || batch.coa_number || batch.batch_number;
            const lookupType = batch.uid ? 'uid' : batch.coa_number ? 'coa' : 'batch';
            const current = batch.id === currentBatchId;
            return <article className={`weedoFactsBatchHistoryItem ${current ? 'current' : ''}`} key={batch.id}>
              <div className="weedoFactsBatchHistoryTitle">
                <strong>{batchLabel(batch)}</strong>
                <span>{batch.verified ? 'Verified COA' : batch.evidenceStatus === 'review' ? 'Under review' : batch.evidenceStatus === 'source_backed' ? 'Source-backed' : 'Unverified'}{current ? ' · Current scan' : ''}</span>
              </div>
              <div className="weedoFactsBatchHistoryMeta">
                <span>{batch.tested_at ? `Tested ${new Date(batch.tested_at).toLocaleDateString()}` : 'Test date unavailable'}</span>
                <span>{batch.lab_name || batch.source_name || 'Source unavailable'}</span>
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
        <div className="weedoFactsBatchPager">
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>← Previous</button>
          <strong>{rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {batches.length.toLocaleString()} · Page {currentPage.toLocaleString()} of {pageCount.toLocaleString()}</strong>
          <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Next →</button>
        </div>
      </> : <p>No batch chemistry history is available yet.</p>}
    </section>
  </>;
}
