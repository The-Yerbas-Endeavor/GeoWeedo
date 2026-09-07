'use client';

import { useEffect, useMemo, useState } from 'react';

type Dispensary = { id: string; name: string; city: string; region: string; active: boolean };
type Entitlement = { id: string; dispensaryId: string; businessId: string; status: string; startsAt: string; endsAt: string; source: string; planCode: string; currency: 'USD' };
type Claim = { id: string; location_id: string; claimant_name: string; business_email?: string; business_phone?: string; role_title?: string; status: string; created_at: string; location?: { name?: string; city?: string; region?: string } };
type Plan = { code: string; name: string; currency: 'USD'; monthlyPriceCents: number; annualPriceCents: number };

function localInput(date: Date) { const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return copy.toISOString().slice(0, 16); }
function money(cents: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100); }

export default function AdminSponsorshipManager() {
  const [dispensaries, setDispensaries] = useState<Dispensary[]>([]);
  const [items, setItems] = useState<Entitlement[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [plan, setPlan] = useState<Plan>({ code:'featured', name:'GeoWeedo Featured', currency:'USD', monthlyPriceCents:3900, annualPriceCents:39000 });
  const [form, setForm] = useState({ dispensaryId: '', source: 'admin_comp', status: 'active', startsAt: localInput(new Date()), endsAt: localInput(new Date(Date.now() + 30 * 86400000)) });
  const [status, setStatus] = useState('Loading business sponsorship workspace…');
  const [busy, setBusy] = useState(false);
  const names = useMemo(() => new Map(dispensaries.map((item) => [item.id, item])), [dispensaries]);

  async function load() {
    const [sponsorResponse, claimResponse] = await Promise.all([
      fetch('/api/admin/sponsorships', { cache: 'no-store' }),
      fetch('/api/admin/owner-claims?status=pending', { cache: 'no-store' }),
    ]);
    if (sponsorResponse.status === 401 || sponsorResponse.status === 403 || claimResponse.status === 401 || claimResponse.status === 403) { window.location.href = '/admin/login'; return; }
    const sponsorData = await sponsorResponse.json(); const claimData = await claimResponse.json();
    if (!sponsorResponse.ok) throw new Error(sponsorData.error || 'Sponsorship admin access failed.');
    if (!claimResponse.ok) throw new Error(claimData.error || 'Could not load ownership claims.');
    setDispensaries(sponsorData.dispensaries || []); setItems(sponsorData.entitlements || []); setClaims(claimData.claims || []); if (sponsorData.plan) setPlan(sponsorData.plan);
    setForm((current) => ({ ...current, dispensaryId: current.dispensaryId || sponsorData.dispensaries?.[0]?.id || '' }));
    setStatus('Business sponsorship workspace ready. Featured listings affect visibility only; gameplay odds remain unchanged.');
  }

  useEffect(() => { load().catch((error) => setStatus(error.message)); }, []);

  async function saveFeatured() {
    setBusy(true); setStatus('Saving Featured entitlement…');
    try {
      const response = await fetch('/api/admin/sponsorships', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save Featured entitlement.');
      setStatus(`Featured listing saved for ${names.get(form.dispensaryId)?.name || form.dispensaryId}.`); await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save Featured entitlement.'); }
    finally { setBusy(false); }
  }

  async function moderateClaim(claimId: string, nextStatus: 'approved'|'rejected') {
    setBusy(true); setStatus(`${nextStatus === 'approved' ? 'Approving' : 'Rejecting'} ownership claim…`);
    try {
      const response = await fetch('/api/admin/owner-claims', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ claimId, status:nextStatus }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not moderate ownership claim.');
      setStatus(`Ownership claim ${nextStatus}.`); await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not moderate ownership claim.'); }
    finally { setBusy(false); }
  }

  async function logout() { await fetch('/api/admin/auth/logout', { method: 'POST' }); window.location.href = '/admin/login'; }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>Businesses & Featured</h1></div><div className="admin-links"><a href="/admin/data">Data import</a><a href="/admin/dispensaries">Dispensaries</a><a href="/admin/rewards">Rewards</a><a href="/">Game</a><button className="ghost" onClick={logout}>Log out</button></div></header>
      <div className="admin-status">{status}</div>

      <section className="admin-grid">
        <div className="admin-panel">
          <h2>Grant GeoWeedo Featured</h2>
          <div className="source-note"><strong>{plan.name}</strong><span>{money(plan.monthlyPriceCents)}/month or {money(plan.annualPriceCents)}/year. Billing is denominated in USD. During rollout, Admin can grant or invoice Featured access without a payment processor.</span></div>
          <div className="admin-form">
            <label><span>Dispensary</span><select value={form.dispensaryId} onChange={(e) => setForm({...form, dispensaryId:e.target.value})}>{dispensaries.map((item) => <option value={item.id} key={item.id}>{item.name} — {item.city}, {item.region}</option>)}</select></label>
            <div className="field-row"><label><span>Starts</span><input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({...form, startsAt:e.target.value})} /></label><label><span>Ends</span><input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({...form, endsAt:e.target.value})} /></label></div>
            <div className="field-row"><label><span>Source</span><select value={form.source} onChange={(e) => setForm({...form, source:e.target.value})}><option value="admin_comp">Admin comp / beta</option><option value="manual_invoice">Manual USD invoice</option><option value="subscription">USD subscription</option></select></label><label><span>Status</span><select value={form.status} onChange={(e) => setForm({...form, status:e.target.value})}><option value="active">Active</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select></label></div>
            <button className="primary" disabled={busy || !form.dispensaryId} onClick={saveFeatured}>Save Featured listing</button>
          </div>
        </div>

        <div className="admin-panel">
          <h2>Featured policy</h2>
          <div className="source-note"><strong>One map renderer</strong><span>Featured status is carried by the normal MapLibre dispensary source. No separate DOM sponsor marker path is required.</span></div>
          <div className="source-note"><strong>Visibility, not pay-to-win</strong><span>Featured changes map/discovery presentation and enables sponsor analytics. It does not alter Classic, Daily Weedo, or Weedo Hunt selection odds.</span></div>
          <div className="source-note"><strong>USD commercial billing</strong><span>Sponsorship subscriptions and payments are kept separate from player rewards and wallet accounting.</span></div>
        </div>
      </section>

      <section className="admin-panel approved-list"><h2>Pending business claims</h2>{claims.length === 0 ? <p>No pending ownership claims.</p> : claims.map((claim) => <div className="candidate-row" key={claim.id}><div><strong>{claim.location?.name || claim.location_id}</strong><span>{claim.claimant_name}{claim.role_title ? ` · ${claim.role_title}` : ''}</span><small>{claim.business_email || claim.business_phone || 'No contact shown'} · submitted {new Date(claim.created_at).toLocaleDateString()}</small></div><div className="candidate-actions"><button disabled={busy} onClick={() => moderateClaim(claim.id,'approved')}>Approve claim</button><button disabled={busy} onClick={() => moderateClaim(claim.id,'rejected')}>Reject</button></div></div>)}</section>

      <section className="admin-panel approved-list"><h2>Featured listings</h2>{items.length === 0 ? <p>No Featured listings yet.</p> : items.map((item) => { const d = names.get(item.dispensaryId); return <div className="candidate-row" key={item.id}><div><strong>{d?.name || item.dispensaryId}</strong><span>{plan.name} · USD · {new Date(item.startsAt).toLocaleDateString()} → {new Date(item.endsAt).toLocaleDateString()}</span><small>{item.source.replaceAll('_',' ')} · business {item.businessId}</small></div><div className="candidate-actions"><span className={`status-pill ${item.status}`}>{item.status}</span></div></div>; })}</section>
    </main>
  );
}
