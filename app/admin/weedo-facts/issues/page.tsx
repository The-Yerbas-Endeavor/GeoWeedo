'use client';

import { useEffect, useState } from 'react';
import styles from './issues.module.css';

type ScanGroup = {
  payload_kind: string;
  qr_host: string;
  resolver: string;
  unique_payloads: number;
  scan_count: number;
  last_seen_at: string;
  sample_value: string;
};

export default function WeedoFactsIssuesPage() {
  const [groups, setGroups] = useState<ScanGroup[]>([]);
  const [totals, setTotals] = useState({ groups: 0, uniquePayloads: 0, scans: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/weedo-facts/issues', { cache: 'no-store' });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Unable to load Weedo Facts issues.');
      setGroups(body.groups || []);
      setTotals(body.totals || { groups: 0, uniquePayloads: 0, scans: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Weedo Facts issues.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <a href="/admin/weedo-facts">← Weedo Facts admin</a>
        <span>ISSUES</span>
        <h1>Unknown scan inbox</h1>
        <p>Only scans GeoWeedo could not resolve appear here. Fix a resolver once instead of manually maintaining individual scan records.</p>
      </div>
      <button onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </header>

    <section className={styles.stats}>
      <div><strong>{totals.groups}</strong><span>issue groups</span></div>
      <div><strong>{totals.uniquePayloads}</strong><span>unique payloads</span></div>
      <div><strong>{totals.scans}</strong><span>total scans</span></div>
    </section>

    {error ? <p className={styles.error}>{error}</p> : null}
    {!loading && !error && groups.length === 0 ? <section className={styles.empty}><strong>No unresolved scans.</strong><span>The scanner currently has nothing waiting for a new resolver.</span></section> : null}

    <section className={styles.list}>
      {groups.map((row, index) => <article className={styles.card} key={`${row.payload_kind}-${row.qr_host}-${row.resolver}-${index}`}>
        <div className={styles.cardHead}>
          <div><span>{row.payload_kind.replace(/_/g, ' ')}</span><h2>{row.qr_host || row.resolver || 'Unknown source'}</h2></div>
          <strong>{row.scan_count} scan{Number(row.scan_count) === 1 ? '' : 's'}</strong>
        </div>
        <dl>
          <dt>Resolver</dt><dd>{row.resolver || 'generic'}</dd>
          <dt>Unique payloads</dt><dd>{row.unique_payloads}</dd>
          <dt>Last seen</dt><dd>{row.last_seen_at ? new Date(row.last_seen_at).toLocaleString() : '—'}</dd>
          <dt>Example</dt><dd className={styles.sample}>{row.sample_value}</dd>
        </dl>
      </article>)}
    </section>
  </main>;
}
