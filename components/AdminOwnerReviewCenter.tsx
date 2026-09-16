'use client';

import { FormEvent, useEffect, useState } from 'react';
import styles from './AdminOwnerReviewCenter.module.css';

type Status = 'all' | 'resolved' | 'review' | 'ambiguous' | 'missing';

type Summary = {
  resolved: number;
  review: number;
  ambiguous: number;
  missing: number;
  total: number;
  evidenceRows: number;
};

type ProductRow = {
  product_id: string;
  brand_name: string | null;
  product_name: string;
  product_type: string | null;
  net_contents: string | null;
  status: Exclude<Status, 'all'>;
  owner_name: string | null;
  owner_type: string | null;
  confidence: number | null;
  evidence_count: number;
  distinct_batch_count: number;
  candidate_count: number;
  updated_at: string;
  states: string | null;
};

type ListPayload = {
  ready: boolean;
  summary: Summary | null;
  products: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  status?: Status;
  sort?: string;
};

type Candidate = {
  owner_name: string;
  normalized_owner_name: string;
  owner_type: string;
  confidence: number;
  evidence_count: number;
  batch_count: number;
  evidence_fields: string | null;
  states: string | null;
};

type Evidence = {
  id: string;
  batch_id: string | null;
  state_code: string | null;
  owner_name: string;
  owner_type: string;
  evidence_field: string;
  evidence_source: string;
  confidence: number;
  source_external_id: string | null;
};

type DetailPayload = {
  ready: true;
  product: ProductRow & { normalized_owner_name: string | null; resolver_version: number };
  candidates: Candidate[];
  evidence: Evidence[];
};

const empty: ListPayload = { ready: true, summary: null, products: [], total: 0, page: 1, pageSize: 25, pageCount: 1, status: 'review', sort: 'batches_desc' };

function pct(value: number | null) {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function statusLabel(status: Status) {
  if (status === 'all') return 'All';
  if (status === 'resolved') return 'Resolved';
  if (status === 'review') return 'Needs review';
  if (status === 'ambiguous') return 'Ambiguous';
  return 'No evidence';
}

export default function AdminOwnerReviewCenter() {
  const [data, setData] = useState<ListPayload>(empty);
  const [status, setStatus] = useState<Status>('review');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState('batches_desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function load(nextPage = page, nextStatus = status, nextQ = q, nextSort = sort, nextPageSize = pageSize) {
    const params = new URLSearchParams({ page: String(nextPage), status: nextStatus, sort: nextSort, pageSize: String(nextPageSize) });
    if (nextQ.trim()) params.set('q', nextQ.trim());
    const response = await fetch(`/api/admin/owner-review?${params}`, { cache: 'no-store' });
    if (response.status === 401) { window.location.href = '/admin/login'; return; }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not load owner review data.');
    setData(body);
    setPage(body.page || 1);
  }

  useEffect(() => {
    setLoading(true);
    load(1, 'review', '', 'batches_desc', 25).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);

  async function chooseStatus(next: Status) {
    setStatus(next); setPage(1); setDetail(null); setLoading(true); setError('');
    try { await load(1, next, q, sort, pageSize); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not change queue.'); }
    finally { setLoading(false); }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setPage(1); setDetail(null); setLoading(true); setError('');
    try { await load(1, status, q, sort, pageSize); }
    catch (err) { setError(err instanceof Error ? err.message : 'Search failed.'); }
    finally { setLoading(false); }
  }

  async function changeSort(next: string) {
    setSort(next); setPage(1); setLoading(true); setError('');
    try { await load(1, status, q, next, pageSize); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sort owner review data.'); }
    finally { setLoading(false); }
  }

  async function changePageSize(next: number) {
    setPageSize(next); setPage(1); setLoading(true); setError('');
    try { await load(1, status, q, sort, next); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not change page size.'); }
    finally { setLoading(false); }
  }

  async function goPage(next: number) {
    setLoading(true); setError(''); setDetail(null);
    try { await load(next, status, q, sort, pageSize); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load page.'); }
    finally { setLoading(false); }
  }

  async function openDetail(productId: string) {
    setDetailLoading(true); setError('');
    try {
      const response = await fetch(`/api/admin/owner-review?productId=${encodeURIComponent(productId)}`, { cache: 'no-store' });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load owner evidence.');
      setDetail(body);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load owner evidence.'); }
    finally { setDetailLoading(false); }
  }

  const summary = data.summary;
  const counts: Record<Status, number> = {
    all: summary?.total || 0,
    resolved: summary?.resolved || 0,
    review: summary?.review || 0,
    ambiguous: summary?.ambiguous || 0,
    missing: summary?.missing || 0,
  };

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>GEOWEEDO ADMIN · DATA QUALITY</span>
        <h1>Owner Review Center</h1>
        <p>Review derived Cannlytics owner evidence without changing canonical products. Strong matches stay separated from licensee-only review, conflicting generic products, and records with no owner evidence.</p>
      </div>
      <div className={styles.headerLinks}>
        <a href="/admin/product-maintenance">Product maintenance</a>
        <a href="/admin/products-menus">Products & scans</a>
        <a href="/admin">Admin</a>
      </div>
    </header>

    {!data.ready ? <section className={`${styles.panel} ${styles.notReady}`}>
      <h2>Owner provenance has not been persisted yet</h2>
      <p>Run <code>npm run weedo:enrich:cannlytics-owners -- --apply</code> after the reviewed dry-run. This page is intentionally read-only and will become available once both derived provenance tables exist.</p>
    </section> : <>
      <section className={styles.stats}>
        <article className={styles.stat}><strong>{(summary?.resolved || 0).toLocaleString()}</strong><span>Strongly resolved</span></article>
        <article className={styles.stat}><strong>{(summary?.review || 0).toLocaleString()}</strong><span>Needs review</span></article>
        <article className={styles.stat}><strong>{(summary?.ambiguous || 0).toLocaleString()}</strong><span>Ambiguous</span></article>
        <article className={styles.stat}><strong>{(summary?.missing || 0).toLocaleString()}</strong><span>No evidence</span></article>
        <article className={styles.stat}><strong>{(summary?.evidenceRows || 0).toLocaleString()}</strong><span>Evidence rows</span></article>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <span className={styles.eyebrow}>OWNER QUEUES</span>
          <h2>Review missing-owner products</h2>
          <p>Click any row to inspect candidate owners, evidence fields, source states, and batch support.</p>
        </div>
        <div className={styles.tabs}>
          {(['review','ambiguous','resolved','missing','all'] as Status[]).map(item => <button key={item} type="button" className={status === item ? styles.active : undefined} onClick={() => chooseStatus(item)}>{statusLabel(item)} · {counts[item].toLocaleString()}</button>)}
        </div>
        <form className={styles.toolbar} onSubmit={search}>
          <input value={q} onChange={event => setQ(event.target.value)} placeholder="Search product or owner…" aria-label="Search owner review" />
          <select value={sort} onChange={event => changeSort(event.target.value)} aria-label="Sort owner review">
            <option value="batches_desc">Most batches first</option>
            <option value="evidence_desc">Most evidence first</option>
            <option value="confidence_desc">Highest confidence</option>
            <option value="name_asc">Product A–Z</option>
            <option value="name_desc">Product Z–A</option>
            <option value="owner_asc">Owner A–Z</option>
          </select>
          <select value={pageSize} onChange={event => changePageSize(Number(event.target.value))} aria-label="Rows per page">
            <option value={25}>25 rows</option><option value={50}>50 rows</option><option value={100}>100 rows</option>
          </select>
          <button type="submit">Search</button>
        </form>

        {loading ? <div className={styles.empty}>Loading owner review queue…</div> : data.products.length === 0 ? <div className={styles.empty}>No products match this queue.</div> : <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>Status</th><th>Product</th><th>Suggested owner</th><th>Type</th><th>Confidence</th><th>Evidence</th><th>Batches</th><th>Candidates</th><th>State</th></tr></thead>
          <tbody>{data.products.map(product => <tr key={product.product_id} data-clickable="true" onClick={() => openDetail(product.product_id)}>
            <td><span className={`${styles.badge} ${styles[product.status]}`}>{statusLabel(product.status)}</span></td>
            <td><span className={styles.productName}>{product.product_name}</span><small>{product.product_type || 'Type not reported'} · {product.product_id}</small></td>
            <td>{product.owner_name ? <span className={styles.owner}>{product.owner_name}</span> : <span className={styles.muted}>—</span>}</td>
            <td>{product.owner_type || '—'}</td>
            <td>{pct(product.confidence)}</td>
            <td>{Number(product.evidence_count || 0).toLocaleString()}</td>
            <td>{Number(product.distinct_batch_count || 0).toLocaleString()}</td>
            <td>{Number(product.candidate_count || 0).toLocaleString()}</td>
            <td>{product.states || '—'}</td>
          </tr>)}</tbody>
        </table></div>}

        <nav className={styles.pagination} aria-label="Owner review pages">
          <button type="button" disabled={data.page <= 1 || loading} onClick={() => goPage(data.page - 1)}>← Previous</button>
          <strong>Page {data.page.toLocaleString()} of {data.pageCount.toLocaleString()} · {data.total.toLocaleString()} products</strong>
          <button type="button" disabled={data.page >= data.pageCount || loading} onClick={() => goPage(data.page + 1)}>Next →</button>
        </nav>
      </section>

      {detailLoading ? <section className={styles.detail}><div className={styles.empty}>Loading evidence…</div></section> : detail ? <section className={styles.detail}>
        <div className={styles.detailHead}>
          <div><span className={styles.eyebrow}>EVIDENCE DETAIL</span><h2>{detail.product.product_name}</h2><p>{detail.product.product_id}</p></div>
          <button type="button" onClick={() => setDetail(null)}>Close</button>
        </div>
        <div className={styles.detailGrid}>
          <div><strong>{detail.product.owner_name || '—'}</strong><span>Current suggested owner</span></div>
          <div><strong>{pct(detail.product.confidence)}</strong><span>Confidence</span></div>
          <div><strong>{Number(detail.product.distinct_batch_count || 0).toLocaleString()}</strong><span>Batches represented</span></div>
          <div><strong>{Number(detail.product.candidate_count || 0).toLocaleString()}</strong><span>Distinct candidates</span></div>
        </div>
        <div className={styles.subpanel}>
          <h3>Owner candidate distribution</h3>
          {detail.candidates.length === 0 ? <div className={styles.empty}>No owner candidates were extracted for this product.</div> : <div className={styles.tableWrap}><table className={styles.candidateTable}>
            <thead><tr><th>Owner candidate</th><th>Type</th><th>Confidence</th><th>Evidence rows</th><th>Batches</th><th>Fields</th><th>States</th></tr></thead>
            <tbody>{detail.candidates.map((candidate, index) => <tr key={`${candidate.normalized_owner_name}-${candidate.owner_type}-${index}`}><td><strong>{candidate.owner_name}</strong></td><td>{candidate.owner_type}</td><td>{pct(candidate.confidence)}</td><td>{Number(candidate.evidence_count || 0).toLocaleString()}</td><td>{Number(candidate.batch_count || 0).toLocaleString()}</td><td>{candidate.evidence_fields || '—'}</td><td>{candidate.states || '—'}</td></tr>)}</tbody>
          </table></div>}
        </div>
        <div className={styles.subpanel}>
          <h3>Evidence sample</h3>
          <div className={styles.tableWrap}><table className={styles.candidateTable}>
            <thead><tr><th>Owner</th><th>Type</th><th>Confidence</th><th>Field</th><th>Batch</th><th>State</th></tr></thead>
            <tbody>{detail.evidence.slice(0, 100).map(row => <tr key={row.id}><td>{row.owner_name}</td><td>{row.owner_type}</td><td>{pct(row.confidence)}</td><td>{row.evidence_field}</td><td>{row.batch_id || '—'}</td><td>{row.state_code || '—'}</td></tr>)}</tbody>
          </table></div>
          {detail.evidence.length > 100 ? <p className={styles.muted}>Showing the first 100 of {detail.evidence.length.toLocaleString()} returned evidence rows.</p> : null}
        </div>
      </section> : null}
    </>}
  </main>;
}
