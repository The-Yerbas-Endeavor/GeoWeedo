'use client';

import { useEffect, useState } from 'react';

type Candidate = {
  id: string; name: string; streetAddress?: string; city?: string; region?: string; country?: string;
  latitude?: number; longitude?: number; website?: string; licenseNumber?: string; dataSource: string;
  sourceUrl?: string; sourceLicense?: string; status: string;
};

export default function AdminDataManager() {
  const [secret, setSecret] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('official-license-registry');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceLicense, setSourceLicense] = useState('official public data');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [status, setStatus] = useState('Unlock to import an official licensing CSV.');
  const [busy, setBusy] = useState(false);

  useEffect(() => { const saved = sessionStorage.getItem('geoweedo-admin-secret'); if (saved) setSecret(saved); }, []);
  const headers = { 'x-geoweedo-admin': secret };

  async function load() {
    sessionStorage.setItem('geoweedo-admin-secret', secret);
    const response = await fetch('/api/admin/candidates', { headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Admin access failed.');
    setCandidates((data.candidates || []).slice().reverse());
    setStatus(`Loaded ${data.candidates?.length || 0} candidate records.`);
  }

  async function upload() {
    if (!file) return setStatus('Choose a CSV file first.');
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

  function review(item: Candidate) {
    sessionStorage.setItem('geoweedo-candidate-draft', JSON.stringify(item));
    window.location.href = '/admin/dispensaries';
  }

  async function reject(item: Candidate) {
    await fetch('/api/admin/candidates', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, status: 'rejected' }) });
    await load();
  }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>Official data import</h1></div><div className="admin-links"><a href="/admin/dispensaries">Imagery validator</a><a href="/admin/sponsorships">Sponsorships</a><a href="/">Game</a></div></header>
      <div className="admin-status">{status}</div>
      <section className="admin-grid">
        <div className="admin-panel">
          <h2>1. Admin access</h2>
          <div className="field-row"><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GEOWEEDO_ADMIN_SECRET" /><button onClick={() => load().catch((e) => setStatus(e.message))}>Unlock</button></div>
          <h2>2. Import licensing CSV</h2>
          <div className="admin-form">
            <select value={source} onChange={(e) => setSource(e.target.value)}><option value="official-license-registry">Official license registry</option><option value="state-open-data">State open data</option><option value="business-supplied">Business supplied</option><option value="weedmaps-authorized">Weedmaps authorized/API</option></select>
            <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Official source URL" />
            <input value={sourceLicense} onChange={(e) => setSourceLicense(e.target.value)} placeholder="Source/license note" />
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button className="primary" disabled={busy || !secret || !file} onClick={upload}>Import candidates</button>
          </div>
          <p className="admin-help">The importer recognizes common name/address/city/state/latitude/longitude/license columns and preserves source provenance. Every row stays a candidate until imagery is validated.</p>
        </div>
        <div className="admin-panel">
          <h2>Official source workflow</h2>
          <div className="source-note"><strong>Oregon</strong><span>OLCC Marijuana Businesses and Endorsements / Oregon Open Data.</span></div>
          <div className="source-note"><strong>Nevada</strong><span>Cannabis Compliance Board active license list and licensed retail locations.</span></div>
          <div className="source-note"><strong>Washington</strong><span>Liquor and Cannabis Board cannabis licensing/open-data exports.</span></div>
          <p className="admin-help">Download the regulator's current CSV/export, import it here, then review candidates one at a time. Do not scrape Weedmaps public listings.</p>
        </div>
      </section>
      <section className="admin-panel approved-list">
        <h2>Candidate review queue</h2>
        {candidates.length === 0 ? <p>No candidates imported yet.</p> : candidates.slice(0, 200).map((item) => <div className="candidate-row" key={item.id}><div><strong>{item.name}</strong><span>{[item.streetAddress,item.city,item.region].filter(Boolean).join(', ') || 'Address needs review'} · {item.dataSource}</span>{item.licenseNumber && <small>License {item.licenseNumber}</small>}</div><div className="candidate-actions"><span className={`status-pill ${item.status}`}>{item.status}</span><button onClick={() => review(item)}>Review imagery</button><button onClick={() => reject(item)}>Reject</button></div></div>)}
      </section>
    </main>
  );
}
