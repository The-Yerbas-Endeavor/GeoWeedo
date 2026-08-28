'use client';

import { useEffect, useMemo, useState } from 'react';

type Player = { id: string; handle: string; yerbasAddress: string; walletVerifiedAt?: string; rewardEligible: boolean };
type Reward = { id: string; playerId: string; amountYerb: number; reason: string; reference?: string; status: string; txid?: string; error?: string; createdAt: string; paidAt?: string };

export default function AdminRewardManager() {
  const [secret, setSecret] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [playerId, setPlayerId] = useState('');
  const [amount, setAmount] = useState('1');
  const [reason, setReason] = useState('GeoWeedo gameplay reward');
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState('Unlock to inspect the YERB reward ledger.');

  useEffect(() => { const saved = sessionStorage.getItem('geoweedo-admin-secret'); if (saved) setSecret(saved); }, []);
  const headers = { 'x-geoweedo-admin': secret };
  const playerMap = useMemo(() => new Map(players.map((item) => [item.id, item])), [players]);

  async function load() {
    sessionStorage.setItem('geoweedo-admin-secret', secret);
    const response = await fetch('/api/admin/rewards', { headers }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Admin access failed.');
    setPlayers(data.players || []); setRewards((data.rewards || []).slice().reverse());
    setPlayerId((current) => current || data.players?.[0]?.id || '');
    setStatus(`Loaded ${data.rewards?.length || 0} reward ledger entries and ${data.players?.length || 0} verified player records.`);
  }

  async function queue() {
    const response = await fetch('/api/admin/rewards', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId, amountYerb: Number(amount), reason, reference }) });
    const data = await response.json(); if (!response.ok) return setStatus(data.error || 'Could not queue reward.');
    setStatus(`Queued ${data.reward.amountYerb} YERB as ${data.reward.id}.`); setReference(''); await load();
  }

  async function setState(item: Reward, next: string) {
    const txid = next === 'paid' ? window.prompt('Enter the payout transaction ID:', item.txid || '') : item.txid;
    if (next === 'paid' && !txid) return;
    const response = await fetch('/api/admin/rewards', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, status: next, txid }) });
    if (response.ok) await load();
  }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>YERB reward ledger</h1></div><div className="admin-links"><a href="/admin/data">Data</a><a href="/admin/dispensaries">Imagery</a><a href="/admin/sponsorships">Sponsorships</a><a href="/">Game</a></div></header>
      <div className="admin-status">{status}</div>
      <section className="admin-grid">
        <div className="admin-panel"><h2>1. Admin access</h2><div className="field-row"><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GEOWEEDO_ADMIN_SECRET" /><button onClick={() => load().catch((e) => setStatus(e.message))}>Unlock</button></div>
          <h2>2. Queue reviewed reward</h2><div className="admin-form"><select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>{players.map((player) => <option value={player.id} key={player.id}>{player.handle} — {player.yerbasAddress}</option>)}</select><input type="number" min="0" step="0.00000001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="YERB amount" /><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" /><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Unique game/reference ID" /><button className="primary" disabled={!secret || !playerId || Number(amount) <= 0} onClick={queue}>Add pending reward</button></div>
        </div>
        <div className="admin-panel"><h2>Payout separation</h2><div className="source-note"><strong>Pending</strong><span>Validated reward awaiting payout review.</span></div><div className="source-note"><strong>Held</strong><span>Fraud/duplicate/account check needs attention.</span></div><div className="source-note"><strong>Paid</strong><span>A payout txid has been recorded in the ledger.</span></div><p className="admin-help">The web app maintains the auditable queue. A separate local payout process should be the only component allowed to spend from the reward wallet.</p></div>
      </section>
      <section className="admin-panel approved-list"><h2>Reward entries</h2>{rewards.length === 0 ? <p>No rewards queued yet.</p> : rewards.map((item) => { const player = playerMap.get(item.playerId); return <div className="candidate-row" key={item.id}><div><strong>{item.amountYerb} YERB · {player?.handle || item.playerId}</strong><span>{item.reason}{item.reference ? ` · ${item.reference}` : ''}</span><small>{item.txid ? `txid ${item.txid}` : player?.yerbasAddress || 'No verified address'}</small></div><div className="candidate-actions"><span className={`status-pill ${item.status}`}>{item.status}</span>{item.status !== 'held' && item.status !== 'paid' && <button onClick={() => setState(item, 'held')}>Hold</button>}{item.status === 'held' && <button onClick={() => setState(item, 'pending')}>Release</button>}{item.status !== 'paid' && <button onClick={() => setState(item, 'paid')}>Record paid</button>}</div></div>; })}</section>
    </main>
  );
}
