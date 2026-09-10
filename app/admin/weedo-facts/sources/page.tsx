'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './sources.module.css';

type Region = {
  code: string;
  label: string;
  upstreamRecords: number;
  importedRecords: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
};

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
  primaryLabel?: string;
  secondaryCount: number;
  secondaryLabel: string;
  regions?: Region[];
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
  const [selectedRegions, setSelectedRegions] = useState<Record<string,string>>({});

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

  async function updateSource(sourceId: string, region?: string) {
    const busyKey = region ? `${sourceId}:${region}` : sourceId;
    setBusy(busyKey);
    setError('');
    try {
      const response = await fetch('/api/admin/weedo-facts/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, region: region || null }),
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
      {sources.map(source => {
        const selectedRegion = selectedRegions[source.id] || '';
        const selected = source.regions?.find(region => region.code === selectedRegion);
        const sourceBusy = source.state === 'running' || busy === source.id || busy.startsWith(`${source.id}:`);
        return <article className={styles.card} key={source.id}>
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
            <div><strong>{source.products.toLocaleString()}</strong><span>{source.primaryLabel || 'products'}</span></div>
            <div><strong>{source.secondaryCount.toLocaleString()}</strong><span>{source.secondaryLabel}</span></div>
          </div>

          <dl>
            <dt>Last started</dt><dd>{formatDate(source.lastStartedAt)}</dd>
            <dt>Last completed</dt><dd>{formatDate(source.lastCompletedAt)}</dd>
            <dt>Source</dt><dd><a href={source.sourceUrl} target="_blank" rel="noreferrer">Open public source ↗</a></dd>
          </dl>

          {source.lastError ? <div className={styles.sourceError}>{source.lastError}</div> : null}

          {source.regions?.length ? <>
            <div className={styles.regionControl}>
              <label>
                <span>State dataset</span>
                <select value={selectedRegion} onChange={event => setSelectedRegions(current => ({ ...current, [source.id]: event.target.value }))}>
                  <option value="">Choose a state…</option>
                  {source.regions.map(region => <option key={region.code} value={region.code}>
                    {region.label} · {region.upstreamRecords.toLocaleString()} upstream · {region.importedRecords.toLocaleString()} imported
                  </option>)}
                </select>
              </label>
              {selected ? <p>{selected.label}: <strong>{selected.upstreamRecords.toLocaleString()}</strong> upstream records · <strong>{selected.importedRecords.toLocaleString()}</strong> currently tracked in GeoWeedo · last completed {formatDate(selected.lastCompletedAt)}.</p> : <p>Choose one state at a time. GeoWeedo will cache the source file, upsert changed records, skip unchanged rows, and preserve stronger direct-lab evidence.</p>}
            </div>
            <details className={styles.regionStatus}>
              <summary>View all Cannlytics state checkpoints</summary>
              <div className={styles.regionTable}>
                {source.regions.map(region => <div key={region.code}>
                  <strong>{region.code.toUpperCase()}</strong><span>{region.label}</span><span>{region.importedRecords.toLocaleString()} / {region.upstreamRecords.toLocaleString()}</span><span>{formatDate(region.lastCompletedAt)}</span>
                </div>)}
              </div>
            </details>
          </> : null}

          <button
            type="button"
            className={styles.update}
            disabled={sourceBusy || Boolean(source.regions?.length && !selectedRegion)}
            onClick={() => updateSource(source.id, selectedRegion || undefined)}
          >
            {sourceBusy ? 'Updating…' : source.regions?.length && selected ? `Update ${selected.label}` : `Update ${source.label}`}
          </button>
          {source.state === 'running' ? <p className={styles.runningNote}>The update is running in the background. This page refreshes automatically.</p> : null}
        </article>;
      })}
    </section>

    <section className={styles.evidence}>
      <h2>Evidence separation</h2>
      <p><strong>SC Labs</strong> feeds direct public laboratory batch chemistry. <strong>Cannlytics</strong> feeds normalized public laboratory and regulatory results under CC BY 4.0; GeoWeedo preserves the upstream source and does not overwrite stronger direct-lab evidence. <strong>Kannapedia</strong> remains a separate cultivar-genetics source, and its registrant-reported chemistry is never promoted to verified lab-batch evidence.</p>
    </section>
  </main>;
}
