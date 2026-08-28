'use client';

import { useEffect, useState } from 'react';

const ATOMIC = 100_000_000;
type Withdrawal = {
  id: string;
  destination_address: string;
  amount_atomic: number;
  fee_atomic: number;
  status: string;
  requested_at: string;
  reviewed_at?: string;
  sent_at?: string;
  txid?: string;
  failure_reason?: string;
  username?: string;
  display_name?: string;
  yerbas_address?: string;
};

export default function AdminWithdrawalManager() {
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [status, setStatus] = useState('Loading withdrawal queue…');
  const [busy, setBusy] = useState('');

  async function load() {
    const response = await fetch('/api/admin/withdrawals', { cache: 'no-store' });
    if (response.status === 401) { window.location.href = '/admin/login'; return; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load withdrawals.');
    setItems(data.withdrawals || []);
    setStatus(`Loaded ${data.withdrawals?.length || 0} withdrawal requests.`);
  }

  useEffect(() => { load().catch((error) => setStatus(error.message)); }, []);

  async function review(id: string, action: 'approve' | 'reject') {
    if (action === 'approve' && !window.confirm('Approve this YERB withdrawal for the restricted wallet worker?')) return;
    if (action === 'reject' && !window.confirm('Reject this withdrawal and release its held balance?')) return;
    setBusy(id);
    try {
      const response = await fetch('/api/admin/withdrawals', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update withdrawal.');
      setStatus(`${id} marked ${data.status}.`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not update withdrawal.');
    } finally {
      setBusy('');
    }
  }

  async function logout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>YERB withdrawals</h1></div><div className="admin-links"><a href="/admin/data">Data</a><a href="/admin/dispensaries">Imagery</a><a href="/admin/rewards">Rewards</a><a href="/admin/sponsorships">Sponsorships</a><a href="/">Game</a><button className="ghost" onClick={logout}>Log out</button></div></header>
      <div className="admin-status">{status}</div>
      <section className="admin-panel approved-list">
        <h2>Withdrawal review queue</h2>
        <p className="admin-help">Approval does not send coins from the web process. It only marks the request eligible for the local restricted wallet worker. `YERB_WITHDRAWALS_ENABLED` must also be true before the worker calls `sendtoaddress`.</p>
        {items.length === 0 ? <p>No withdrawals yet.</p> : items.map((item) => (
          <div className="candidate-row" key={item.id}>
            <div>
              <strong>{(Number(item.amount_atomic) / ATOMIC).toFixed(8)} YERB · {item.display_name || item.username || 'Player'}</strong>
              <span>To {item.destination_address}</span>
              <small>Requested {new Date(item.requested_at).toLocaleString()}{item.yerbas_address ? ` · login wallet ${item.yerbas_address}` : ''}</small>
              {item.txid && <small>txid {item.txid}</small>}
              {item.failure_reason && <small>{item.failure_reason}</small>}
            </div>
            <div className="candidate-actions">
              <span className={`status-pill ${item.status}`}>{item.status}</span>
              {item.status === 'requested' && <><button disabled={busy === item.id} onClick={() => review(item.id, 'approve')}>Approve</button><button disabled={busy === item.id} onClick={() => review(item.id, 'reject')}>Reject</button></>}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
