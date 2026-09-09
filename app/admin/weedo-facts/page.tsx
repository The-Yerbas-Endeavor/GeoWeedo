'use client';

import { useEffect, useState } from 'react';
import styles from './weedo-facts-admin.module.css';

type Submission = any;

function lookupHref(identifier: string, type: string) {
  return `/api/weedo-facts/lookup?identifier=${encodeURIComponent(identifier)}&type=${encodeURIComponent(type)}`;
}

export default function WeedoFactsAdminPage() {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastLookup, setLastLookup] = useState('');

  async function load(nextStatus = status) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/weedo-facts/coa-reviews?status=${encodeURIComponent(nextStatus)}`, { cache: 'no-store' });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Unable to load COA reviews.');
      setItems(body.submissions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load COA reviews.');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(status); }, [status]);

  async function review(submissionId: string, action: 'approve_exact_batch' | 'needs_info' | 'reject') {
    const notes = window.prompt(action === 'approve_exact_batch' ? 'Optional approval notes:' : 'Review notes:', '') ?? '';
    if (action !== 'approve_exact_batch' && !notes.trim()) return;
    setBusy(submissionId);
    setError('');
    try {
      const response = await fetch('/api/admin/weedo-facts/coa-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, action, reviewNotes: notes }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Review action failed.');
      if (body.lookupUrl) setLastLookup(body.lookupUrl);
      await load(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review action failed.');
    } finally { setBusy(''); }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <a href="/admin" className={styles.back}>← Admin</a>
        <span className={styles.eyebrow}>WEEDO FACTS</span>
        <h1>COA review</h1>
        <p>Review submitted SC Labs PDFs, compare them against existing GeoWeedo records, and promote verified evidence into an exact batch record.</p>
      </div>
      <div className={styles.links}>
        <a href="/weedo-facts" target="_blank" rel="noreferrer">Open Weedo Facts</a>
        <a href="/api/weedo-facts/lookup?identifier=260609S011&type=coa" target="_blank" rel="noreferrer">Test fixture lookup</a>
      </div>
    </header>

    <section className={styles.toolbar}>
      {['pending','needs_info','approved','rejected','all'].map(value => <button key={value} className={status===value?styles.active:''} onClick={() => setStatus(value)}>{value.replace('_',' ')}</button>)}
      <button onClick={() => load(status)}>Refresh</button>
    </section>

    {lastLookup ? <div className={styles.success}>Exact batch approved. <a href={lastLookup} target="_blank" rel="noreferrer">Open verified lookup →</a></div> : null}
    {error ? <div className={styles.error}>{error}</div> : null}
    {loading ? <p className={styles.loading}>Loading review queue…</p> : null}
    {!loading && items.length === 0 ? <div className={styles.empty}>No submissions in this queue.</div> : null}

    <section className={styles.list}>
      {items.map(item => {
        const parsed = item.coa?.parsed || {};
        const analytes = Array.isArray(parsed.analytes) ? parsed.analytes : [];
        const preview = item.matchPreview || {};
        const productCandidates = Array.isArray(preview.productCandidates) ? preview.productCandidates : [];
        const batchCandidates = Array.isArray(preview.batchCandidates) ? preview.batchCandidates : [];
        const identifiers = preview.identifiers || {};
        return <article className={styles.card} key={item.id}>
          <div className={styles.cardHead}>
            <div>
              <span className={styles.status}>{item.status}</span>
              <h2>{item.brand_name ? `${item.brand_name} — ` : ''}{item.product_name || parsed.productName || 'Unnamed product'}</h2>
              <p>Submitted by {item.submitter_display_name || item.username} · {new Date(item.created_at).toLocaleString()}</p>
            </div>
            {item.coa ? <span className={styles.coaBadge}>COA ATTACHED</span> : <span className={styles.noCoa}>NO COA</span>}
          </div>

          <div className={styles.grid}>
            <section><h3>Submitted package</h3><dl>
              <dt>Identifier</dt><dd>{item.identifier_type}: {item.identifier_value}</dd>
              <dt>Batch / lot</dt><dd>{item.batch_number || '—'}</dd>
              <dt>UID</dt><dd>{item.uid || '—'}</dd>
              <dt>COA URL</dt><dd>{item.coa_url ? <a href={item.coa_url} target="_blank" rel="noreferrer">Open source</a> : '—'}</dd>
              <dt>Notes</dt><dd>{item.notes || '—'}</dd>
            </dl></section>
            <section><h3>Parsed SC Labs evidence</h3><dl>
              <dt>Sample ID</dt><dd>{parsed.sampleId || '—'}</dd>
              <dt>Product</dt><dd>{parsed.productName || '—'}</dd>
              <dt>Batch</dt><dd>{parsed.batchNumber || '—'}</dd>
              <dt>UID</dt><dd>{parsed.uid || '—'}</dd>
              <dt>Lab result</dt><dd>{parsed.overallStatus || '—'}</dd>
              <dt>Analytes</dt><dd>{analytes.length}</dd>
              <dt>SHA-256</dt><dd className={styles.hash}>{item.coa?.sha256 || '—'}</dd>
            </dl></section>
          </div>

          <div className={styles.grid}>
            <section>
              <h3>Existing GeoWeedo matches</h3>
              {preview.hasPotentialConflict ? <p><strong>⚠ Potential conflict:</strong> a matching batch identifier points at a different product candidate. Do not approve until resolved.</p> : null}
              {productCandidates.length === 0 && batchCandidates.length === 0 ? <p>No existing product or batch match found.</p> : null}
              {productCandidates.length > 0 ? <div>
                <strong>Products</strong>
                <ul>{productCandidates.map((row: any) => <li key={row.id}>{[row.brandName, row.productName].filter(Boolean).join(' — ')} <small>({row.reason})</small></li>)}</ul>
              </div> : null}
              {batchCandidates.length > 0 ? <div>
                <strong>Batches</strong>
                <ul>{batchCandidates.map((row: any) => <li key={row.id}>{[row.brandName, row.productName].filter(Boolean).join(' — ')} · batch {row.batchNumber || '—'} · {row.verified ? 'verified' : 'unverified'} <small>({row.reasons.join(', ')})</small></li>)}</ul>
              </div> : null}
            </section>
            <section>
              <h3>Test current lookup</h3>
              <p>Open these before approval to see what GeoWeedo currently returns. After approval, the exact identifier should return <code>exact_batch</code>.</p>
              <ul>
                {identifiers.uid ? <li><a href={lookupHref(identifiers.uid, 'uid')} target="_blank" rel="noreferrer">Lookup UID {identifiers.uid} →</a></li> : null}
                {identifiers.sampleId ? <li><a href={lookupHref(identifiers.sampleId, 'coa')} target="_blank" rel="noreferrer">Lookup COA/sample {identifiers.sampleId} →</a></li> : null}
                {identifiers.batchNumber ? <li><a href={lookupHref(identifiers.batchNumber, 'batch')} target="_blank" rel="noreferrer">Lookup batch {identifiers.batchNumber} →</a></li> : null}
                {!identifiers.uid && !identifiers.sampleId && !identifiers.batchNumber ? <li>No batch identity parsed yet.</li> : null}
              </ul>
            </section>
          </div>

          {item.coa ? <div className={styles.pdfRow}><a href={`/api/admin/weedo-facts/coa-reviews/${encodeURIComponent(item.id)}/pdf`} target="_blank" rel="noreferrer">View private COA PDF →</a></div> : null}

          <div className={styles.actions}>
            <button disabled={busy===item.id || !item.coa || !['pending','needs_info'].includes(item.status) || preview.hasPotentialConflict} className={styles.approve} onClick={() => review(item.id,'approve_exact_batch')}>✓ Approve exact batch</button>
            <button disabled={busy===item.id || !['pending','needs_info'].includes(item.status)} onClick={() => review(item.id,'needs_info')}>Needs info</button>
            <button disabled={busy===item.id || !['pending','needs_info'].includes(item.status)} className={styles.reject} onClick={() => review(item.id,'reject')}>Reject</button>
          </div>
        </article>;
      })}
    </section>
  </main>;
}
