'use client';

import { useEffect, useMemo, useState } from 'react';

type Candidate = {
  id: string; name: string; streetAddress?: string; city?: string; region?: string; country?: string;
  latitude?: number; longitude?: number; website?: string; licenseNumber?: string; dataSource: string;
  sourceUrl?: string; sourceLicense?: string; status: string;
  imageryStatus?: 'unchecked' | 'coverage' | 'no_coverage' | 'missing_coordinates' | 'error';
  imageryCount?: number; imageryCheckedAt?: string; imageryMessage?: string;
};

export default function AdminDataManager() {
  const [secret, setSecret] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('official-license-registry');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceLicense, setSourceLicense] = useState('official public data');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [status, setStatus] = useState('Unlock to import official licensing data.');
  const [busy, setBusy] = useState(false);

  useEffect(() => { const saved = sessionStorage.getItem('geoweedo-admin-secret'); if (saved) setSecret(saved); }, []);
  const headers = { 'x-geoweedo-admin': secret };

  const stats = useMemo(() => ({
    total: candidates.length,
    coverage: candidates.filter((item) => item.imageryStatus === 'coverage').length,
    noCoverage: candidates.filter((item) => item.imageryStatus === 'no_coverage').length,
    missingCoordinates: candidates.filter((item) => item.imageryStatus === 'missing_coordinates').length,
    unchecked: candidates.filter((item) => !item.imageryStatus || item.imageryStatus === 'unchecked').length,
  }), [candidates]);

  async function load() {
    sessionStorage.setItem('geoweedo-admin-secret', secret);
    const response = await fetch('/api/admin/candidates', { headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Admin access failed.');
    setCandidates((data.candidates || []).slice().reverse());
    setStatus(`Loaded ${data.candidates?.length || 0} candidate records.`);
  }

  async function upload() {
    if (!file) return setStatus('Choose a CSV or JSON file first.');
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file); form.set('dataSource', source); form.set('sourceUrl', sourceUrl); form.set('sourceLicense', sourceLicense);
      const response = await fetch('/api/admin/candidates/import', { method: 'POST', headers, body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import failed.');
      setStatus(`Parsed ${data.parsed} rows; added ${data.added} new candidates. ${data.total} candidates are now queued.`);
      await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Import failed.'); }
    finally { setBusy(false); }
  }

  async function fetchOfficial(preset: 'oregon-olcc' | 'nevada-ccb' | 'washington-lcb', label: string) {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/candidates/fetch-official', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ preset }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `${label} fetch failed.`);
      setStatus(`${label}: fetched ${data.fetched} rows and added ${data.added} new candidates. ${data.total} candidates are queued.`);
      await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : `${label} fetch failed.`); }
    finally { setBusy(false); }
  }

  async function checkImageryBatch() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/candidates/check-imagery', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 10 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Batch imagery check failed.');
      setStatus(`Checked ${data.checked} candidates. KartaView checks are intentionally limited to 10 per run to protect the public service.`);
      await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Batch imagery check failed.'); }
    finally { setBusy(false); }
  }

  function useCaliforniaPreset() {
    setSource('california-dcc');
    setSourceUrl('https://www.cannabis.ca.gov/resources/search-for-licensed-business/');
    setSourceLicense('California Department of Cannabis Control official license data');
    setStatus('California DCC preset selected. Import a current DCC export and prioritize active Type 10 storefront retailer licenses.');
  }

  function review(item: Candidate) {
    sessionStorage.setItem('geoweedo-candidate-draft', JSON.stringify(item));
    window.location.href = '/admin/dispensaries';
  }

  async function reject(item: Candidate) {
    await fetch('/api/admin/candidates', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, status: 'rejected' }) });
    await load();
  }

  function imageryLabel(item: Candidate) {
    if (item.imageryStatus === 'coverage') return `KartaView: ${item.imageryCount || 0} nearby`;
    if (item.imageryStatus === 'no_coverage') return 'Needs hosted imagery';
    if (item.imageryStatus === 'missing_coordinates') return 'Needs coordinates';
    if (item.imageryStatus === 'error') return 'Imagery check error';
    return 'Imagery unchecked';
  }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>Official data import</h1></div><div className="admin-links"><a href="/admin/dispensaries">Imagery validator</a><a href="/admin/rewards">Rewards</a><a href="/admin/sponsorships">Sponsorships</a><a href="/">Game</a></div></header>
      <div className="admin-status">{status}</div>
      <section className="admin-grid">
        <div className="admin-panel">
          <h2>1. Admin access</h2>
          <div className="field-row"><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GEOWEEDO_ADMIN_SECRET" /><button onClick={() => load().catch((e) => setStatus(e.message))}>Unlock</button></div>
          <h2>2. Import licensing CSV / JSON</h2>
          <div className="admin-form">
            <select value={source} onChange={(e) => setSource(e.target.value)}><option value="official-license-registry">Official license registry</option><option value="california-dcc">California DCC</option><option value="oregon-olcc">Oregon OLCC</option><option value="nevada-ccb">Nevada CCB</option><option value="washington-lcb-open-data">Washington LCB open data</option><option value="state-open-data">Other state open data</option><option value="business-supplied">Business supplied</option><option value="weedmaps-authorized">Weedmaps authorized/API</option></select>
            <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Official source URL" />
            <input value={sourceLicense} onChange={(e) => setSourceLicense(e.target.value)} placeholder="Source/license note" />
            <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button className="primary" disabled={busy || !secret || !file} onClick={upload}>Import candidates</button>
          </div>
          <p className="admin-help">The importer recognizes common business/name/address/city/state/latitude/longitude/license fields in CSV or JSON and preserves source provenance. Every record stays a candidate until imagery is validated.</p>
        </div>
        <div className="admin-panel">
          <h2>Official source presets</h2>
          <div className="source-note"><strong>California · DCC</strong><span>DCC license search is refreshed daily. Prioritize active Type 10 storefront retailer licenses. Use the DCC export until a stable public bulk API is confirmed.</span><button className="secondary" onClick={useCaliforniaPreset}>Use California DCC preset</button></div>
          <div className="source-note"><strong>Oregon · direct import</strong><span>OLCC Cannabis Business Licenses &amp; Endorsements from Oregon Open Data.</span><button className="secondary" disabled={busy || !secret} onClick={() => fetchOfficial('oregon-olcc', 'Oregon OLCC')}>Fetch Oregon retailers now</button></div>
          <div className="source-note"><strong>Nevada · direct import</strong><span>CCB's official licensed retail-location list is parsed directly.</span><button className="secondary" disabled={busy || !secret} onClick={() => fetchOfficial('nevada-ccb', 'Nevada CCB')}>Fetch Nevada retailers now</button></div>
          <div className="source-note"><strong>Washington · direct open data</strong><span>LCB Cannabis Renewal dataset on data.wa.gov (brpd-b6zd). This avoids the Public Records commercial-use restriction.</span><button className="secondary" disabled={busy || !secret} onClick={() => fetchOfficial('washington-lcb', 'Washington LCB')}>Fetch Washington open data now</button></div>
        </div>
      </section>

      <section className="admin-panel approved-list">
        <div className="queue-toolbar"><div><h2>Batch imagery triage</h2><p className="admin-help">Coverage {stats.coverage} · Hosted imagery needed {stats.noCoverage} · Coordinates needed {stats.missingCoordinates} · Unchecked {stats.unchecked}</p></div><button className="primary" disabled={busy || !secret || stats.unchecked === 0} onClick={checkImageryBatch}>Check next 10</button></div>
      </section>

      <section className="admin-panel approved-list">
        <h2>Candidate review queue</h2>
        {candidates.length === 0 ? <p>No candidates imported yet.</p> : candidates.slice(0, 300).map((item) => <div className="candidate-row" key={item.id}><div><strong>{item.name}</strong><span>{[item.streetAddress,item.city,item.region].filter(Boolean).join(', ') || 'Address needs review'} · {item.dataSource}</span>{item.licenseNumber && <small>License {item.licenseNumber}</small>}<small>{imageryLabel(item)}</small></div><div className="candidate-actions"><span className={`status-pill ${item.imageryStatus || 'unchecked'}`}>{item.imageryStatus || 'unchecked'}</span><button onClick={() => review(item)}>Review imagery</button><button onClick={() => reject(item)}>Reject</button></div></div>)}
      </section>
    </main>
  );
}
