'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './sources.module.css';

type Region = {
  code: string;
  label: string;
  upstreamRecords: number;
  importedRecords: number;
  processedRecords: number;
  nextRowOffset: number;
  progressPercent: number;
  resumable: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastProgressAt: string | null;
  lastError: string | null;
};

type Source = {
  id: string;
  label: string;
  kind: string;
  sourceUrl: string;
  description: string;
  state: 'idle' | 'running' | 'success' | 'error';
  stale?: boolean;
  heartbeatDelayed?: boolean;
  heartbeatAgeMs?: number | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastHeartbeatAt?: string | null;
  lastError: string | null;
  records: number;
  products: number;
  primaryLabel?: string;
  secondaryCount: number;
  secondaryLabel: string;
  regions?: Region[];
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatAge(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '';
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s ago`;
}

async function responseJson(response: Response) {
  const text = await response.text();
  if (!text) throw new Error(`Source status returned an empty response (${response.status}).`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Source status returned an invalid response (${response.status}).`); }
}

function stoppedByAdmin(source: Source) {
  return Boolean(source.lastError?.startsWith('Stopped by admin.'));
}

function stateClass(source: Source) {
  if (stoppedByAdmin(source)) return styles.stopped;
  if (source.stale) return styles.errorState;
  if (source.heartbeatDelayed) return styles.delayed;
  if (source.state === 'running') return styles.running;
  if (source.state === 'success') return styles.success;
  if (source.state === 'error') return styles.errorState;
  return '';
}

export default function WeedoFactsSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshWarning, setRefreshWarning] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<Record<string,string>>({});
  const hasSources = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/weedo-facts/sources', { cache: 'no-store' });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body?.error || 'Unable to load data sources.');
      const nextSources = Array.isArray(body?.sources) ? body.sources : [];
      setSources(nextSources);
      hasSources.current = true;
      setError('');
      setRefreshWarning('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load data sources.';
      if (hasSources.current) {
        setRefreshWarning(message.includes('temporarily busy')
          ? message
          : `Source status refresh was interrupted. Keeping the last good status and retrying automatically. ${message}`);
      } else {
        setError(message);
      }
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
    setRefreshWarning('');
    try {
      const response = await fetch('/api/admin/weedo-facts/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', sourceId, region: region || null }),
      });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body?.error || 'Unable to start source update.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start source update.');
    } finally {
      setBusy('');
    }
  }

  async function stopCannlytics() {
    if (!window.confirm('Stop the Cannlytics importer? The active chunk will be terminated and the last saved checkpoint will be preserved for Resume.')) return;
    setBusy('cannlytics:stop');
    setError('');
    setRefreshWarning('');
    try {
      const response = await fetch('/api/admin/weedo-facts/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop', sourceId: 'cannlytics' }),
      });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body?.error || 'Unable to stop Cannlytics update.');
      setRefreshWarning(body?.message || 'Stop requested. Waiting for the importer to exit safely…');
      await new Promise(resolve => window.setTimeout(resolve, 1000));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to stop Cannlytics update.');
    } finally {
      setBusy('');
    }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <a href="/admin/weedo-facts" className={styles.back}>← GeoWeedo Facts admin</a>
        <span className={styles.eyebrow}>GEOWEEDO FACTS DATA SOURCES</span>
        <h1>Source updates</h1>
        <p>Refresh public source data at any time. Large Cannlytics states run in durable chunks, save checkpoints, and can resume after a restart without discarding records already imported.</p>
      </div>
      <button type="button" className={styles.refresh} onClick={load}>Refresh status</button>
    </header>

    {error ? <div className={styles.error}>{error}</div> : null}
    {refreshWarning ? <div className={styles.warning}>{refreshWarning}</div> : null}
    {loading ? <div className={styles.loading}>Loading source status…</div> : null}

    <section className={styles.grid}>
      {sources.map(source => {
        const selectedRegion = selectedRegions[source.id] || '';
        const selected = source.regions?.find(region => region.code === selectedRegion);
        const sourceBusy = source.state === 'running' || busy === source.id || busy.startsWith(`${source.id}:`);
        const selectedResumable = Boolean(selected?.resumable || (selected && selected.processedRecords > 0 && selected.processedRecords < selected.upstreamRecords && !selected.lastCompletedAt));
        const wasStopped = stoppedByAdmin(source);
        const stateLabel = wasStopped ? 'stopped' : source.stale ? 'stalled' : source.heartbeatDelayed ? 'heartbeat delayed' : source.state;
        return <article className={styles.card} key={source.id}>
          <div className={styles.cardHead}>
            <div>
              <span className={styles.kind}>{source.kind}</span>
              <h2>{source.label}</h2>
            </div>
            <span className={`${styles.state} ${stateClass(source)}`}>{stateLabel}</span>
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
            {source.state === 'running' ? <><dt>Heartbeat</dt><dd>{formatDate(source.lastHeartbeatAt)}{source.heartbeatAgeMs != null ? ` · ${formatAge(source.heartbeatAgeMs)}` : ''}</dd></> : null}
            <dt>Source</dt><dd><a href={source.sourceUrl} target="_blank" rel="noreferrer">Open public source ↗</a></dd>
          </dl>

          {source.lastError ? <div className={wasStopped ? styles.stopNotice : styles.sourceError}>{source.lastError}</div> : null}

          {source.regions?.length ? <>
            <div className={styles.regionControl}>
              <label>
                <span>State dataset</span>
                <select value={selectedRegion} onChange={event => setSelectedRegions(current => ({ ...current, [source.id]: event.target.value }))}>
                  <option value="">Choose a state…</option>
                  {source.regions.map(region => <option key={region.code} value={region.code}>
                    {region.label} · {region.upstreamRecords.toLocaleString()} upstream · {region.importedRecords.toLocaleString()} tracked
                  </option>)}
                </select>
              </label>
              {selected ? <p>
                {selected.label}: <strong>{selected.importedRecords.toLocaleString()}</strong> records currently tracked in GeoWeedo · <strong>{selected.progressPercent.toFixed(1)}%</strong> checkpoint progress
                {selected.nextRowOffset > 0 ? <> · resume row <strong>{selected.nextRowOffset.toLocaleString()}</strong></> : null}
                {' · '}current upstream <strong>{selected.upstreamRecords.toLocaleString()}</strong>
                {' · '}last progress {formatDate(selected.lastProgressAt)} · last completed {formatDate(selected.lastCompletedAt)}.
              </p> : <p>Choose one state at a time. GeoWeedo caches the source file, saves progress between chunks, upserts changed records, skips unchanged rows, and preserves stronger direct-lab evidence.</p>}
            </div>
            <details className={styles.regionStatus}>
              <summary>View all Cannlytics state checkpoints</summary>
              <div className={styles.regionTable}>
                {source.regions.map(region => <div key={region.code}>
                  <strong>{region.code.toUpperCase()}</strong><span>{region.label}</span><span>{region.importedRecords.toLocaleString()} tracked / {region.upstreamRecords.toLocaleString()} upstream · {region.progressPercent.toFixed(1)}%</span><span>{region.lastProgressAt ? formatDate(region.lastProgressAt) : formatDate(region.lastCompletedAt)}</span>
                </div>)}
              </div>
            </details>
          </> : null}

          <div className={source.id === 'cannlytics' && source.state === 'running' ? styles.actionRow : undefined}>
            <button
              type="button"
              className={styles.update}
              disabled={sourceBusy || Boolean(source.regions?.length && !selectedRegion)}
              onClick={() => updateSource(source.id, selectedRegion || undefined)}
            >
              {sourceBusy ? 'Updating…' : source.regions?.length && selected ? `${selectedResumable ? 'Resume' : 'Update'} ${selected.label}` : `Update ${source.label}`}
            </button>
            {source.id === 'cannlytics' && source.state === 'running' ? <button
              type="button"
              className={styles.stop}
              disabled={busy === 'cannlytics:stop'}
              onClick={stopCannlytics}
            >{busy === 'cannlytics:stop' ? 'Stopping…' : 'Stop Cannlytics'}</button> : null}
          </div>
          {source.state === 'running' && !source.heartbeatDelayed ? <p className={styles.runningNote}>The updater is reporting normally in production-safe mode. Cannlytics uses short write batches, pauses between chunks, and this page refreshes every 15 seconds.</p> : null}
          {source.state === 'running' && source.heartbeatDelayed && !source.stale ? <p className={styles.runningNote}>Heartbeat is delayed. The worker may still be processing a long SQLite write; GeoWeedo will keep the last good status and retry automatically.</p> : null}
          {source.stale ? <p className={styles.runningNote}>The previous worker stopped reporting for more than 10 minutes. Select the state and use Resume to continue safely from its saved checkpoint.</p> : null}
        </article>;
      })}
    </section>

    <section className={styles.evidence}>
      <h2>Evidence separation</h2>
      <p><strong>SC Labs</strong> feeds direct public laboratory batch chemistry. <strong>Cannlytics</strong> feeds normalized public laboratory and regulatory results under CC BY 4.0; GeoWeedo preserves the upstream source and does not overwrite stronger direct-lab evidence. <strong>Kannapedia</strong> remains a separate cultivar-genetics source, and its registrant-reported chemistry is never promoted to verified lab-batch evidence.</p>
    </section>
  </main>;
}
