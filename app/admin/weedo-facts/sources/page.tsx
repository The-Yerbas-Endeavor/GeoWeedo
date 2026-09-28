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
  sourceLimitation?: string | null;
};

type Diagnostic = {
  state: string;
  configuredUpstreamRecords: number;
  sourceFile: string;
  usedCache: boolean;
  sampleLimit: number;
  sampledRows: number;
  rowsWithProductName: number;
  rowsWithIdentifier: number;
  rowsWithAnalytes: number;
  eligibleRows: number;
  missingProductName: number;
  missingIdentifier: number;
  missingAnalytes: number;
  duplicateEligibleKeys: number;
  eligiblePercent: number;
  diagnosis: string;
  headers: string[];
  examples: Array<{ productName: string; identifier: string; analytes: number; producer?: string | null }>;
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

function regionHealth(region: Region, diagnostic?: Diagnostic) {
  if (region.sourceLimitation) {
    return { label: 'SOURCE LIMITATION', className: styles.regionSourceLimit, note: region.sourceLimitation };
  }
  if (diagnostic?.diagnosis === 'source-missing-product-identity') {
    return { label: 'SOURCE LIMITATION', className: styles.regionSourceLimit, note: 'The current source does not provide a product identity GeoWeedo can safely promote. Chemistry is preserved at the source level, but this state should not create canonical products until stronger identity data is available.' };
  }
  if (diagnostic?.diagnosis === 'parser-healthy' && (region.nextRowOffset > 0 || (region.processedRecords > 0 && region.progressPercent < 100))) {
    return { label: 'READY TO RESUME', className: styles.regionReady, note: `Parser validated: ${diagnostic.eligiblePercent.toFixed(1)}% of the sampled rows are eligible. Continue from the saved raw-row checkpoint.` };
  }
  if (region.processedRecords === 0 && region.importedRecords > 0) {
    return { label: 'LEGACY CHECKPOINT', className: styles.regionLegacy, note: 'Tracked records exist, but this import predates the resumable processed-row checkpoint.' };
  }
  if (region.progressPercent >= 100 && region.importedRecords === 0 && region.upstreamRecords > 0) {
    return { label: 'REVIEW', className: styles.regionReview, note: 'The source was traversed but no Cannlytics records are currently tracked. Review this state before treating it as complete.' };
  }
  if (region.processedRecords > 0 && region.progressPercent < 100 && region.importedRecords === 0) {
    return { label: 'REVIEW', className: styles.regionReview, note: 'Checkpoint progress exists but no Cannlytics records are currently tracked.' };
  }
  if (region.importedRecords > region.upstreamRecords && region.upstreamRecords > 0) {
    return { label: 'HISTORICAL > CURRENT', className: styles.regionHistorical, note: 'GeoWeedo retains tracked source history; the current upstream file is smaller than the accumulated tracked set.' };
  }
  if (region.progressPercent >= 100) {
    return { label: 'COMPLETE', className: styles.regionComplete, note: 'The current source file has been traversed to the end.' };
  }
  if (region.nextRowOffset > 0 || region.processedRecords > 0) {
    return { label: 'RESUMABLE', className: styles.regionPartial, note: 'The state is partially processed and can continue from its saved raw-row checkpoint.' };
  }
  return { label: 'NOT STARTED', className: styles.regionIdle, note: 'No resumable source-row checkpoint has been recorded yet.' };
}

export default function WeedoFactsSourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshWarning, setRefreshWarning] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<Record<string,string>>({});
  const [diagnostics, setDiagnostics] = useState<Record<string, Diagnostic>>({});
  const [diagnosing, setDiagnosing] = useState('');
  const hasSources = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/weedo-facts/sources', { cache: 'no-store' });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body?.error || 'Unable to load data sources.');
      const nextSources = Array.isArray(body?.sources) ? body.sources.filter((source: Source) => source.id === 'cannlytics') : [];
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

  async function diagnoseRegion(region: string) {
    setDiagnosing(region);
    setError('');
    setRefreshWarning('');
    try {
      const response = await fetch('/api/admin/weedo-facts/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'diagnose', sourceId: 'cannlytics', region }),
      });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await responseJson(response);
      if (!response.ok) throw new Error(body?.error || 'Unable to diagnose Cannlytics state.');
      if (body?.diagnostic) setDiagnostics(current => ({ ...current, [region]: body.diagnostic }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to diagnose Cannlytics state.');
    } finally {
      setDiagnosing('');
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
        <p>Manage GeoWeedo's Cannlytics product and laboratory data here. Large state imports run in durable chunks, save checkpoints, and can resume safely.</p>
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
            <dt>Source</dt><dd><a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.id === 'cannlytics' ? 'Cannlytics Cannabis Results ↗' : 'Open public source ↗'}</a></dd>
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
              {selected ? (() => {
                const health = regionHealth(selected, diagnostics[selected.code]);
                return <div className={styles.regionSummary}>
                  <div className={styles.regionSummaryHead}>
                    <strong>{selected.label}</strong>
                    <span className={health.className}>{health.label}</span>
                  </div>
                  <div className={styles.regionMetrics}>
                    <div><span>Source rows</span><strong>{selected.upstreamRecords.toLocaleString()}</strong></div>
                    <div><span>Processed</span><strong>{selected.processedRecords.toLocaleString()}</strong></div>
                    <div><span>Tracked</span><strong>{selected.importedRecords.toLocaleString()}</strong></div>
                    <div><span>Progress</span><strong>{selected.progressPercent.toFixed(1)}%</strong></div>
                  </div>
                  <p>{health.note}{selected.nextRowOffset > 0 ? <> Resume at raw row <strong>{selected.nextRowOffset.toLocaleString()}</strong>.</> : null}</p>
                  <p>Last progress {formatDate(selected.lastProgressAt)} · last completed {formatDate(selected.lastCompletedAt)}.</p>
                  <button
                    type="button"
                    className={styles.diagnose}
                    disabled={sourceBusy || diagnosing === selected.code}
                    onClick={() => diagnoseRegion(selected.code)}
                  >{diagnosing === selected.code ? 'Diagnosing source…' : 'Diagnose source parser'}</button>
                  {diagnostics[selected.code] ? (() => {
                    const diagnostic = diagnostics[selected.code];
                    return <div className={styles.diagnostic}>
                      <div className={styles.diagnosticHead}>
                        <strong>{
                          diagnostic.diagnosis === 'parser-healthy'
                            ? 'Parser sample looks healthy'
                            : diagnostic.diagnosis === 'source-missing-product-identity'
                              ? 'Source does not provide product identity'
                              : diagnostic.diagnosis === 'product-identity-unresolved'
                                ? 'Product identity field unresolved'
                                : 'No eligible rows found in sample'
                        }</strong>
                        <span>{diagnostic.sampledRows.toLocaleString()} rows sampled</span>
                      </div>
                      <div className={styles.diagnosticMetrics}>
                        <div><span>Product name</span><strong>{diagnostic.rowsWithProductName.toLocaleString()}</strong></div>
                        <div><span>Identifier</span><strong>{diagnostic.rowsWithIdentifier.toLocaleString()}</strong></div>
                        <div><span>Analytes</span><strong>{diagnostic.rowsWithAnalytes.toLocaleString()}</strong></div>
                        <div><span>Eligible</span><strong>{diagnostic.eligibleRows.toLocaleString()} · {diagnostic.eligiblePercent.toFixed(1)}%</strong></div>
                      </div>
                      {diagnostic.diagnosis === 'source-missing-product-identity' ? <p><strong>Protected:</strong> GeoWeedo will not manufacture product names from product type, sample IDs, or other weak fields. This state needs a stronger product-identity source before its chemistry can create canonical products.</p> : null}
                      <p>Missing product name: <strong>{diagnostic.missingProductName.toLocaleString()}</strong> · missing identifier: <strong>{diagnostic.missingIdentifier.toLocaleString()}</strong> · missing analytes: <strong>{diagnostic.missingAnalytes.toLocaleString()}</strong> · duplicate eligible keys: <strong>{diagnostic.duplicateEligibleKeys.toLocaleString()}</strong>.</p>
                      <p>Source file: <strong>{diagnostic.sourceFile}</strong>{diagnostic.usedCache ? ' · cached copy' : ' · refreshed copy'}.</p>
                      {diagnostic.examples.length ? <details><summary>Show eligible examples</summary>{diagnostic.examples.map((example,index)=><div className={styles.diagnosticExample} key={example.identifier + '-' + index}><strong>{example.productName}</strong><span>{example.producer || 'Producer not reported'} · {example.identifier} · {example.analytes} analytes</span></div>)}</details> : null}
                    </div>;
                  })() : null}
                </div>;
              })() : <p>Choose one state at a time. <strong>Processed</strong> is how many raw source rows GeoWeedo has traversed; <strong>tracked</strong> is how many eligible Cannlytics source records are currently stored. Those numbers are not expected to match.</p>}
            </div>
            <details className={styles.regionStatus}>
              <summary>View all Cannlytics state checkpoints</summary>
              <div className={styles.regionTable}>
                <div className={styles.regionTableHead}><span>State</span><span>Source rows</span><span>Processed</span><span>Tracked</span><span>Progress</span><span>Status</span><span>Last activity</span></div>
                {source.regions.map(region => {
                  const health = regionHealth(region, diagnostics[region.code]);
                  return <div key={region.code}>
                    <span><strong>{region.code.toUpperCase()}</strong><small>{region.label}</small></span>
                    <span>{region.upstreamRecords.toLocaleString()}</span>
                    <span>{region.processedRecords.toLocaleString()}</span>
                    <span>{region.importedRecords.toLocaleString()}</span>
                    <span>{region.progressPercent.toFixed(1)}%</span>
                    <span className={health.className}>{health.label}</span>
                    <span>{region.lastProgressAt ? formatDate(region.lastProgressAt) : formatDate(region.lastCompletedAt)}</span>
                  </div>;
                })}
              </div>
            </details>
          </> : null}

          <div className={source.id === 'cannlytics' && source.state === 'running' ? styles.actionRow : undefined}>
            <button
              type="button"
              className={styles.update}
              disabled={sourceBusy || Boolean(source.regions?.length && !selectedRegion) || Boolean(selected?.sourceLimitation) || diagnostics[selectedRegion]?.diagnosis === 'source-missing-product-identity'}
              onClick={() => updateSource(source.id, selectedRegion || undefined)}
            >
              {sourceBusy
                ? 'Updating…'
                : source.regions?.length && selected
                  ? diagnostics[selected.code]?.diagnosis === 'parser-healthy' && selected.nextRowOffset > 0
                    ? `Resume ${selected.label} from row ${selected.nextRowOffset.toLocaleString()}`
                    : selected.sourceLimitation || diagnostics[selected.code]?.diagnosis === 'source-missing-product-identity'
                      ? `${selected.label} source needs product identity`
                      : `${selectedResumable ? 'Resume' : 'Update'} ${selected.label}`
                  : `Update ${source.label}`}
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
      <h2>Cannlytics evidence</h2>
      <p>Cannlytics feeds normalized public laboratory and regulatory results under CC BY 4.0. GeoWeedo preserves source provenance and does not overwrite stronger direct-lab evidence.</p>
    </section>
  </main>;
}
