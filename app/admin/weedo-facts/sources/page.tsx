'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './sources.module.css';

type Source = {
  id: string;
  label: string;
  kind: string;
  sourceUrl: string;
  description: string;
  state: 'idle' | 'running' | 'success' | 'error';
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  records: number;
  products: number;
  secondaryCount: number;
  secondaryLabel: string;
};

function formatDate(value: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function stateClass(state: Source['state']) {
  if (state === 'running') return styles.running;
  if (state === 'success') return styles.success;
  if (state === 'error') return styles.errorState;
  return '';
}

export default function WeedoFactsSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/weedo-facts/sources', { cache: 'no-store' });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Unable to load data sources.');
      setSources(body.sources || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load data sources.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!sources.some(source => source.state === 'running')) return;
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [sources, load]);

  async function updateSource(sourceId: string) {
    setBusy(sourceId);
    setError('');
    try {
      const response = await fetch('/api/admin/weedo-facts/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId }),
      });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Unable to start source update.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start source update.');
    } finally {
      setBusy('');
    }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <a href="/admin/weedo-facts" className={styles.back}>← Weedo Facts admin</a>
        <span className={styles.eyebrow}>WEEDO DATA SOURCES</span>
        <h1>Source updates</h1>
        <p>Refresh public source data at any time. Updates are incremental: existing records are refreshed and newly discovered records are added instead of performing a one-time blanket load.</p>
      </div>
      <button type="button" className={styles.refresh} onClick={load}>Refresh status</button>
    </header>

    {error ? <div className={styles.error}>{error}</div> : null}
    {loading ? <div className={styles.loading}>Loading source status…</div> : null}

    <section className={styles.grid}>
      {sources.map(source => <article className={styles.card} key={source.id}>
        <div className={styles.cardHead}>
          <div>
            <span className={styles.kind}>{source.kind}</span>
            <h2>{source.label}</h2>
          </div>
          <span className={`${styles.state} ${stateClass(source.state)}`}>{source.state}</span>
        </div>
        <p className={styles.description}>{source.description}</p>

        <div className={styles.stats}>
          <div><strong>{source.records.toLocaleString()}</strong><span>records</span></div>
          <div><strong>{source.products.toLocaleString()}</strong><span>{source.id === 'sc-labs' ? 'products' : 'cultivars'}</span></div>
          <div><strong>{source.secondaryCount.toLocaleString()}</strong><span>{source.secondaryLabel}</span></div>
        </div>

        <dl>
          <dt>Last started</dt><dd>{formatDate(source.lastStartedAt)}</dd>
          <dt>Last completed</dt><dd>{formatDate(source.lastCompletedAt)}</dd>
          <dt>Source</dt><dd><a href={source.sourceUrl} target="_blank" rel="noreferrer">Open public source ↗</a></dd>
        </dl>

        {source.lastError ? <div className={styles.sourceError}>{source.lastError}</div> : null}

        <button
          type="button"
          className={styles.update}
          disabled={source.state === 'running' || busy === source.id}
          onClick={() => updateSource(source.id)}
        >
          {source.state === 'running' || busy === source.id ? 'Updating…' : `Update ${source.label}`}
        </button>
        {source.state === 'running' ? <p className={styles.runningNote}>The update is running in the background. This page refreshes automatically.</p> : null}
      </article>)}
    </section>

    <section className={styles.evidence}>
      <h2>Evidence separation</h2>
      <p><strong>SC Labs</strong> feeds verified laboratory batch chemistry into Product Chemistry. <strong>Kannapedia</strong> feeds cultivar genetics and registrant-reported chemistry into Cultivar Genetics. Kannapedia chemistry is never promoted to verified lab-batch evidence.</p>
    </section>
  </main>;
}
