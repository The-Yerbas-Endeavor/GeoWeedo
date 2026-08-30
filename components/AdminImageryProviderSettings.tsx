'use client';

import { useEffect, useState } from 'react';

type Provider = 'google' | 'kartaview' | 'auto';
type UsageRow = { usage_date: string; provider: string; request_type: string; request_count: number };
type Settings = {
  provider: Provider;
  envDefault: string;
  googleConfigured: boolean;
  warningLimit: number;
  warning: boolean;
  usage: {
    rows: UsageRow[];
    today: string;
    googleToday: number;
    googleImagesToday: number;
    googleMetadataToday: number;
  };
};

async function readJson(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Server returned ${response.status} ${response.statusText} instead of JSON.`); }
}

export default function AdminImageryProviderSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [provider, setProvider] = useState<Provider>('kartaview');
  const [warningLimit, setWarningLimit] = useState(500);
  const [status, setStatus] = useState('Loading imagery provider settings…');
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch('/api/admin/imagery-provider', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (response.status === 401) { window.location.href = '/admin/login'; return; }
    const data = await readJson(response);
    if (!response.ok) throw new Error(data.error || 'Could not load imagery provider settings.');
    setSettings(data);
    setProvider(data.provider);
    setWarningLimit(data.warningLimit);
    setStatus('');
  }

  useEffect(() => { load().catch(error => setStatus(error instanceof Error ? error.message : 'Could not load settings.')); }, []);

  async function save() {
    setBusy(true);
    setStatus('Saving imagery provider…');
    try {
      const response = await fetch('/api/admin/imagery-provider', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ provider, warningLimit }),
      });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || 'Could not save imagery provider settings.');
      await load();
      setStatus(`Street imagery switched to ${provider === 'google' ? 'Google Street View' : provider === 'kartaview' ? 'KartaView' : 'Auto (Google → KartaView)'}.`);
      window.dispatchEvent(new Event('geoweedo-imagery-provider-updated'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save imagery provider settings.');
    } finally { setBusy(false); }
  }

  const usage = settings?.usage;
  const pct = settings && settings.warningLimit > 0 ? Math.round((settings.usage.googleImagesToday / settings.warningLimit) * 100) : 0;

  return (
    <section className="admin-panel" style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0 }}>Street imagery provider</h2>
      <p className="admin-help">Switch providers immediately without editing environment files. Google API credentials remain server-side. Auto tries Google first and falls back to KartaView.</p>
      <div className="admin-form" style={{ maxWidth: 620 }}>
        <select value={provider} onChange={event => setProvider(event.target.value as Provider)}>
          <option value="google">Google Street View</option>
          <option value="kartaview">KartaView</option>
          <option value="auto">Auto · Google → KartaView</option>
        </select>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Daily Google image warning threshold</span>
          <input type="number" min="0" max="1000000" value={warningLimit} onChange={event => setWarningLimit(Math.max(0, Number(event.target.value) || 0))} />
        </label>
        <button className="primary" disabled={busy || (provider === 'google' && settings?.googleConfigured === false)} onClick={save}>{busy ? 'Saving…' : 'Save provider'}</button>
      </div>

      {settings && <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
        {!settings.googleConfigured && <div className="admin-status">Google is not configured on this server. Add GOOGLE_MAPS_API_KEY before selecting Google.</div>}
        {settings.warning && <div className="admin-status"><strong>Google usage warning:</strong> {settings.usage.googleImagesToday} image requests today has reached the configured {settings.warningLimit} request warning threshold.</div>}
        <div className="admin-help">Active provider: <strong>{settings.provider}</strong> · Env default: {settings.envDefault} · Google today: {settings.usage.googleImagesToday} image + {settings.usage.googleMetadataToday} metadata requests{settings.warningLimit > 0 ? ` · ${pct}% of warning threshold` : ' · warning disabled'}.</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Date</th><th style={{ textAlign: 'left' }}>Provider</th><th style={{ textAlign: 'left' }}>Type</th><th style={{ textAlign: 'right' }}>Requests</th></tr></thead>
            <tbody>{usage?.rows.slice(0, 21).map(row => <tr key={`${row.usage_date}-${row.provider}-${row.request_type}`}><td>{row.usage_date}</td><td>{row.provider}</td><td>{row.request_type}</td><td style={{ textAlign: 'right' }}>{row.request_count}</td></tr>)}</tbody>
          </table>
        </div>
      </div>}
      {status && <div className="admin-status" style={{ marginTop: 12 }}>{status}</div>}
    </section>
  );
}
