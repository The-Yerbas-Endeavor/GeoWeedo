'use client';

import { useEffect, useMemo, useState } from 'react';

type Dispensary = { id: string; name: string; city: string; region: string; active: boolean };
type Sponsorship = { id: string; dispensaryId: string; amountYerb: number; paymentTxid?: string; priorityWeight: number; status: string; startsAt: string; endsAt: string };

function localInput(date: Date) { const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return copy.toISOString().slice(0, 16); }

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
    setStatus('Sponsorship dashboard ready. Active campaigns can influence at most one round per standard game.');
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
    setForm({ dispensaryId: item.dispensaryId, amountYerb: String(item.amountYerb), paymentTxid: item.paymentTxid || '', priorityWeight: String(item.priorityWeight), status: item.status, startsAt: localInput(new Date(item.startsAt)), endsAt: localInput(new Date(item.endsAt)) });
    setStatus(`Editing ${item.id}.`);
  }

  function clearEdit() {
    setEditingId('');
    setForm((current) => ({ ...current, amountYerb: '100', paymentTxid: '', priorityWeight: '1', status: 'pending', startsAt: localInput(new Date()), endsAt: localInput(new Date(Date.now() + 30 * 86400000)) }));
    setStatus('New sponsorship form ready.');
  }

  async function logout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>YERB sponsorships</h1></div><div className="admin-links"><a href="/admin/data">Data import</a><a href="/admin/dispensaries">Imagery</a><a href="/admin/rewards">Rewards</a><a href="/">Game</a><button className="ghost" onClick={logout}>Log out</button></div></header>
      <div className="admin-status">{status}</div>
      <section className="admin-grid">
        <div className="admin-panel">
          <h2>{editingId ? 'Edit campaign' : 'New campaign'}</h2><div className="admin-form">
            <select value={form.dispensaryId} onChange={(e) => setForm({...form, dispensaryId:e.target.value})}>{dispensaries.map((item) => <option value={item.id} key={item.id}>{item.name} — {item.city}, {item.region}</option>)}</select>
            <div className="field-row"><input type="number" min="0" step="0.00000001" value={form.amountYerb} onChange={(e) => setForm({...form, amountYerb:e.target.value})} placeholder="YERB paid" /><input type="number" min="1" max="100" value={form.priorityWeight} onChange={(e) => setForm({...form, priorityWeight:e.target.value})} placeholder="Priority weight" /></div>
            <input value={form.paymentTxid} onChange={(e) => setForm({...form, paymentTxid:e.target.value})} placeholder="Payment transaction ID" />
            <div className="field-row"><input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({...form, startsAt:e.target.value})} /><input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({...form, endsAt:e.target.value})} /></div>
            <select value={form.status} onChange={(e) => setForm({...form, status:e.target.value})}><option value="pending">Pending payment/review</option><option value="active">Active</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select>
            <div className="field-row"><button className="primary" disabled={busy || !form.dispensaryId} onClick={save}>{editingId ? 'Update sponsorship' : 'Create sponsorship'}</button><button disabled={!editingId} onClick={clearEdit}>Clear edit</button></div>
          </div>
        </div>
        <div className="admin-panel"><h2>Placement and accounting policy</h2><div className="source-note"><strong>One featured round maximum</strong><span>Standard games can include no more than one active sponsored dispensary.</span></div><div className="source-note"><strong>Daily challenge stays clean</strong><span>Daily competitive sets should be generated without sponsorship weighting.</span></div><div className="source-note"><strong>Score never changes</strong><span>Payment can affect selection frequency only, not answer, distance, points, or player YERB rate.</span></div><div className="source-note"><strong>On-chain receipt</strong><span>Activation requires a YERB payment txid. The payment is posted once to the platform sponsorship-income ledger.</span></div></div>
      </section>
      <section className="admin-panel approved-list"><h2>Sponsorship ledger</h2>{items.length === 0 ? <p>No campaigns yet.</p> : items.map((item) => { const d = names.get(item.dispensaryId); return <div className="candidate-row" key={item.id}><div><strong>{d?.name || item.dispensaryId}</strong><span>{item.amountYerb} YERB · priority {item.priorityWeight} · {new Date(item.startsAt).toLocaleDateString()} → {new Date(item.endsAt).toLocaleDateString()}</span><small>{item.paymentTxid || 'Payment txid not recorded'}</small></div><div className="candidate-actions"><span className={`status-pill ${item.status}`}>{item.status}</span><button onClick={() => edit(item)}>Edit</button></div></div>; })}</section>
    </main>
  );
}
