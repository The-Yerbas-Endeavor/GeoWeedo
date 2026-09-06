'use client';

import { useEffect, useMemo, useState } from 'react';

type Dispensary = { id: string; name: string; city: string; region: string; active: boolean };
type Sponsorship = { id: string; dispensaryId: string; amountYerb: number; paymentTxid?: string; priorityWeight: number; status: string; startsAt: string; endsAt: string };

const PRIORITY_OPTIONS = [1, 2, 3, 5, 10];
function localInput(date: Date) { const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return copy.toISOString().slice(0, 16); }
function normalizedPriority(value: number) { return PRIORITY_OPTIONS.includes(value) ? value : PRIORITY_OPTIONS.reduce((best, option) => Math.abs(option - value) < Math.abs(best - value) ? option : best, 1); }

export default function AdminSponsorshipManager() {
  const [dispensaries, setDispensaries] = useState<Dispensary[]>([]);
  const [items, setItems] = useState<Sponsorship[]>([]);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({ dispensaryId: '', amountYerb: '100', paymentTxid: '', priorityWeight: '1', status: 'pending', startsAt: localInput(new Date()), endsAt: localInput(new Date(Date.now() + 30 * 86400000)) });
  const [status, setStatus] = useState('Loading YERB sponsorship ledger…');
  const [busy, setBusy] = useState(false);
  const names = useMemo(() => new Map(dispensaries.map((item) => [item.id, item])), [dispensaries]);

  async function load() {
    const response = await fetch('/api/admin/sponsorships', { cache: 'no-store' });
    if (response.status === 401) { window.location.href = '/admin/login'; return; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Admin access failed.');
    setDispensaries(data.dispensaries || []); setItems((data.sponsorships || []).slice().reverse());
    setForm((current) => ({ ...current, dispensaryId: current.dispensaryId || data.dispensaries?.[0]?.id || '' }));
    setStatus('Sponsorship dashboard ready. Active campaigns now receive Daily Weedo feature priority and can influence one standard-game round.');
  }

  useEffect(() => { load().catch((error) => setStatus(error.message)); }, []);

  async function save() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/sponsorships', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, id: editingId || undefined, amountYerb: Number(form.amountYerb), priorityWeight: Number(form.priorityWeight), startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save sponsorship.');
      setStatus(`${editingId ? 'Updated' : 'Created'} sponsorship ${data.sponsorship.id}.`); setEditingId(''); await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save sponsorship.'); }
    finally { setBusy(false); }
  }

  function edit(item: Sponsorship) {
    setEditingId(item.id);
    setForm({ dispensaryId: item.dispensaryId, amountYerb: String(item.amountYerb), paymentTxid: item.paymentTxid || '', priorityWeight: String(normalizedPriority(item.priorityWeight)), status: item.status, startsAt: localInput(new Date(item.startsAt)), endsAt: localInput(new Date(item.endsAt)) });
    setStatus(`Editing ${item.id}.`);
  }

  function clearEdit() {
    setEditingId('');
    setForm((current) => ({ ...current, amountYerb: '100', paymentTxid: '', priorityWeight: '1', status: 'pending', startsAt: localInput(new Date()), endsAt: localInput(new Date(Date.now() + 30 * 86400000)) }));
    setStatus('New sponsorship form ready.');
  }

  async function logout() { await fetch('/api/admin/auth/logout', { method: 'POST' }); window.location.href = '/admin/login'; }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>YERB sponsorships</h1></div><div className="admin-links"><a href="/admin/data">Data import</a><a href="/admin/dispensaries">Imagery</a><a href="/admin/rewards">Rewards</a><a href="/">Game</a><button className="ghost" onClick={logout}>Log out</button></div></header>
      <div className="admin-status">{status}</div>
      <section className="admin-grid">
        <div className="admin-panel">
          <h2>{editingId ? 'Edit campaign' : 'New campaign'}</h2><div className="admin-form">
            <label><span>Sponsored dispensary</span><select value={form.dispensaryId} onChange={(e) => setForm({...form, dispensaryId:e.target.value})}>{dispensaries.map((item) => <option value={item.id} key={item.id}>{item.name} — {item.city}, {item.region}</option>)}</select></label>
            <div className="field-row">
              <label><span>Sponsorship amount (YERB)</span><input type="number" min="0" step="0.00000001" value={form.amountYerb} onChange={(e) => setForm({...form, amountYerb:e.target.value})} /></label>
              <label><span>Daily feature weight</span><select value={form.priorityWeight} onChange={(e) => setForm({...form, priorityWeight:e.target.value})}>{PRIORITY_OPTIONS.map((weight) => <option key={weight} value={weight}>{weight}× selection weight</option>)}</select></label>
            </div>
            <div className="source-note"><strong>What does feature weight mean?</strong><span>It only matters when multiple sponsors are active. A 2× sponsor receives about twice the Daily Weedo selection chance of a 1× sponsor; 5× receives about five times the chance. It does not change scoring or YERB rewards.</span></div>
            <label><span>Payment transaction ID</span><input value={form.paymentTxid} onChange={(e) => setForm({...form, paymentTxid:e.target.value})} placeholder="YERB payment txid" /></label>
            <div className="field-row"><label><span>Campaign starts</span><input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({...form, startsAt:e.target.value})} /></label><label><span>Campaign ends</span><input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({...form, endsAt:e.target.value})} /></label></div>
            <label><span>Campaign status</span><select value={form.status} onChange={(e) => setForm({...form, status:e.target.value})}><option value="pending">Pending payment/review</option><option value="active">Active</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select></label>
            <div className="field-row"><button className="primary" disabled={busy || !form.dispensaryId} onClick={save}>{editingId ? 'Update sponsorship' : 'Create sponsorship'}</button><button disabled={!editingId} onClick={clearEdit}>Clear edit</button></div>
          </div>
        </div>
        <div className="admin-panel"><h2>Placement and accounting policy</h2><div className="source-note"><strong>🌎 Daily Weedo feature priority</strong><span>If one or more active, in-date sponsors are enabled, Daily Weedo selects from that sponsor pool first. Daily feature weight controls relative selection chance when multiple sponsors are active.</span></div><div className="source-note"><strong>Fallback stays playable</strong><span>If no eligible sponsor is active, Daily Weedo automatically selects from enabled GeoWeedo dispensaries.</span></div><div className="source-note"><strong>One featured standard round maximum</strong><span>Standard games can include no more than one active sponsored dispensary.</span></div><div className="source-note"><strong>Score never changes</strong><span>Sponsorship affects selection and visibility only. It never changes the answer, distance, points, or player YERB reward rate.</span></div><div className="source-note"><strong>On-chain receipt</strong><span>Activation requires a YERB payment txid. The payment is posted once to the platform sponsorship-income ledger.</span></div></div>
      </section>
      <section className="admin-panel approved-list"><h2>Sponsorship ledger</h2>{items.length === 0 ? <p>No campaigns yet.</p> : items.map((item) => { const d = names.get(item.dispensaryId); return <div className="candidate-row" key={item.id}><div><strong>{d?.name || item.dispensaryId}</strong><span>{item.amountYerb} YERB · {item.priorityWeight}× Daily feature weight · {new Date(item.startsAt).toLocaleDateString()} → {new Date(item.endsAt).toLocaleDateString()}</span><small>{item.paymentTxid || 'Payment txid not recorded'}</small></div><div className="candidate-actions"><span className={`status-pill ${item.status}`}>{item.status}</span><button onClick={() => edit(item)}>Edit</button></div></div>; })}</section>
    </main>
  );
}
