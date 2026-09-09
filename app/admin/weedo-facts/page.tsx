'use client';

import { FormEvent, useEffect, useState } from 'react';
import styles from './weedo-facts-admin.module.css';

type Submission = any;
type RetrievedState = { record: any | null; sample: any | null; imported: boolean } | null;

function lookupHref(identifier: string, type: string) {
  return `/api/weedo-facts/lookup?identifier=${encodeURIComponent(identifier)}&type=${encodeURIComponent(type)}`;
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

export default function WeedoFactsAdminPage() {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastLookup, setLastLookup] = useState('');
  const [retrieveValue, setRetrieveValue] = useState('260609S011');
  const [retrieving, setRetrieving] = useState(false);
  const [retrieveError, setRetrieveError] = useState('');
  const [retrieved, setRetrieved] = useState<RetrievedState>(null);

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

  async function retrieveLabData(event?: FormEvent) {
    event?.preventDefault();
    const value = retrieveValue.trim();
    if (!value) return;
    setRetrieving(true);
    setRetrieveError('');
    setRetrieved(null);

    try {
      let identifier = value;
      let identifierType = 'unknown';
      let sample: any = null;
      let imported = false;

      if (isUrl(value)) {
        const ingestResponse = await fetch('/api/admin/weedo-facts/sc-labs/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceUrl: value }),
        });
        if (ingestResponse.status === 401) { window.location.href = '/admin/login'; return; }
        const ingestBody = await ingestResponse.json();
        if (!ingestResponse.ok) throw new Error(ingestBody?.error || 'Unable to retrieve SC Labs data.');
        sample = ingestBody.sample || null;
        imported = true;
        if (sample?.uid) { identifier = sample.uid; identifierType = 'uid'; }
        else if (sample?.coaNumber || sample?.sampleId) { identifier = sample.coaNumber || sample.sampleId; identifierType = 'coa'; }
        else if (sample?.batchNumber) { identifier = sample.batchNumber; identifierType = 'batch'; }
        else {
          setRetrieved({ record: null, sample, imported });
          return;
        }
      }

      const response = await fetch(lookupHref(identifier, identifierType), { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Unable to retrieve Weedo Facts data.');
      if (!body.found) {
        setRetrieved({ record: null, sample, imported });
        setRetrieveError(`No GeoWeedo lab record found for ${identifier}.`);
        return;
      }
      setRetrieved({ record: body.record, sample, imported });
    } catch (err) {
      setRetrieveError(err instanceof Error ? err.message : 'Unable to retrieve lab data.');
    } finally {
      setRetrieving(false);
    }
  }

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

  const retrievedRecord = retrieved?.record;
  const retrievedSample = retrieved?.sample;
  const retrievedImported = Boolean(retrieved?.imported);
  const retrievedAnalytes = retrievedRecord
    ? (retrievedRecord.cannabinoids?.length || 0) + (retrievedRecord.terpenes?.length || 0) + (retrievedRecord.safetyTests?.length || 0)
    : 0;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <a href="/admin" className={styles.back}>← Admin</a>
        <span className={styles.eyebrow}>WEEDO FACTS</span>
        <h1>COA review</h1>
        <p>Retrieve lab data, review submitted SC Labs PDFs, compare records, and promote verified evidence into Weedo Facts.</p>
      </div>
      <div className={styles.links}>
        <a href="/weedo-facts" target="_blank" rel="noreferrer">Open Weedo Facts</a>
      </div>
    </header>

    <section className={styles.retrievePanel}>
      <div className={styles.retrieveHead}>
        <div><span>LAB DATA RETRIEVAL</span><h2>Retrieve COA / sample data</h2></div>
        <p>Enter an existing sample ID, UID, batch/lot, or a public SC Labs PhytoFacts URL. SC Labs URLs are fetched and ingested before the record is displayed.</p>
      </div>
      <form className={styles.retrieveForm} onSubmit={retrieveLabData}>
        <input value={retrieveValue} onChange={event => setRetrieveValue(event.target.value)} placeholder="260609S011 or https://client.sclabs.com/.../phytofacts/" aria-label="COA, sample, UID, batch, or SC Labs URL" />
        <button type="submit" disabled={retrieving || !retrieveValue.trim()}>{retrieving ? 'Retrieving…' : 'Retrieve data'}</button>
      </form>
      {retrieveError ? <div className={styles.error}>{retrieveError}</div> : null}
      {retrievedRecord ? <div className={styles.retrievedCard}>
        <div className={styles.retrievedTitle}>
          <div><span>{retrievedImported ? 'SC LABS DATA RETRIEVED' : 'GEOWEEDO RECORD FOUND'}</span><h3>{retrievedRecord.brandName ? `${retrievedRecord.brandName} — ` : ''}{retrievedRecord.productName}</h3></div>
          <strong>{retrievedRecord.matchLevel === 'exact_batch' ? 'VERIFIED BATCH RECORD' : retrievedRecord.matchLevel}</strong>
        </div>
        <dl>
          <dt>Sample / COA</dt><dd>{retrievedRecord.coaNumber || retrievedSample?.sampleId || '—'}</dd>
          <dt>Batch / lot</dt><dd>{retrievedRecord.batchNumber || '—'}</dd>
          <dt>UID</dt><dd>{retrievedRecord.uid || '—'}</dd>
          <dt>Laboratory</dt><dd>{retrievedRecord.labName || retrievedSample?.labName || '—'}</dd>
          <dt>Tested / issued</dt><dd>{retrievedRecord.testedAt ? new Date(retrievedRecord.testedAt).toLocaleDateString() : '—'}</dd>
          <dt>Lab status</dt><dd>{retrievedRecord.overallStatus || '—'}</dd>
          <dt>Analytes loaded</dt><dd>{retrievedAnalytes}</dd>
        </dl>
        <div className={styles.retrieveLinks}>
          {retrievedRecord.productId ? <a href={`/product/${encodeURIComponent(retrievedRecord.productId)}${retrievedRecord.batchId ? `?batch=${encodeURIComponent(retrievedRecord.batchId)}` : ''}`} target="_blank" rel="noreferrer">Open Nutritional Facts listing →</a> : null}
          {(retrievedRecord.coaUrl || retrievedRecord.source?.url) ? <a href={retrievedRecord.coaUrl || retrievedRecord.source.url} target="_blank" rel="noreferrer">Open lab source ↗</a> : null}
        </div>
      </div> : null}
      {retrieved && !retrievedRecord && !retrieveError ? <div className={styles.empty}>Data was retrieved, but the source did not expose enough identity to resolve a GeoWeedo batch record.</div> : null}
    </section>

    <div className={styles.queueIntro}><strong>COA review queue</strong><span>The queue below contains user-submitted COA PDFs. Existing/imported lab records are retrieved above and do not need a submission to appear.</span></div>

    <section className={styles.toolbar}>
      {['pending','needs_info','approved','rejected','all'].map(value => <button key={value} className={status===value?styles.active:''} onClick={() => setStatus(value)}>{value.replace('_',' ')}</button>)}
      <button onClick={() => load(status)}>Refresh</button>
    </section>

    {lastLookup ? <div className={styles.success}>Exact batch approved. <a href={lastLookup} target="_blank" rel="noreferrer">Open verified lookup →</a></div> : null}
    {error ? <div className={styles.error}>{error}</div> : null}
    {loading ? <p className={styles.loading}>Loading review queue…</p> : null}
    {!loading && items.length === 0 ? <div className={styles.empty}>No submitted COAs in this queue.</div> : null}

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
              {productCandidates.length > 0 ? <div><strong>Products</strong><ul>{productCandidates.map((row: any) => <li key={row.id}>{[row.brandName, row.productName].filter(Boolean).join(' — ')} <small>({row.reason})</small></li>)}</ul></div> : null}
              {batchCandidates.length > 0 ? <div><strong>Batches</strong><ul>{batchCandidates.map((row: any) => <li key={row.id}>{[row.brandName, row.productName].filter(Boolean).join(' — ')} · batch {row.batchNumber || '—'} · {row.verified ? 'verified' : 'unverified'} <small>({row.reasons.join(', ')})</small></li>)}</ul></div> : null}
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
