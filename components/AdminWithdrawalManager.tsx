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
  const [rpcConfigured, setRpcConfigured] = useState(false);

  async function load() {
    const response = await fetch('/api/admin/withdrawals', { cache: 'no-store' });
    if (response.status === 401) { window.location.href = '/admin/login'; return; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load withdrawals.');
    setItems(data.withdrawals || []);
    setRpcConfigured(Boolean(data.rpcConfigured));
    setStatus(`Loaded ${data.withdrawals?.length || 0} withdrawal requests.`);
  }

  useEffect(() => { load().catch((error) => setStatus(error.message)); }, []);

  async function action(id: string, action: 'approve' | 'reject' | 'send') {
    if (action === 'approve' && !window.confirm('Approve this YERB withdrawal? Approval does not send coins yet.')) return;
    if (action === 'reject' && !window.confirm('Reject this withdrawal and release its held balance?')) return;
    if (action === 'send' && !window.confirm('Send this approved YERB withdrawal from the GeoWeedo wallet now? This creates an on-chain transaction and cannot be undone.')) return;
    setBusy(id);
    try {
      const response = await fetch('/api/admin/withdrawals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update withdrawal.');
      setStatus(action === 'send' && data.txid ? `${id} sent. txid ${data.txid}` : `${id} marked ${data.status}.`);
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
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>YERB withdrawals</h1></div><div className="admin-links"><a href="/admin/wallet">Wallet</a><a href="/admin/data">Data</a><a href="/admin/dispensaries">Imagery</a><a href="/admin/rewards">Rewards</a><a href="/admin/sponsorships">Sponsorships</a><a href="/">Game</a><button className="ghost" onClick={logout}>Log out</button></div></header>
      <div className="admin-status">{status}</div>
      <section className="admin-panel approved-list">
        <h2>Withdrawal review queue</h2>
        <p className="admin-help">Player withdrawals reserve their YERB immediately. Review the request, approve it, then use <strong>Send YERB</strong> to create the on-chain transaction through the configured Yerbas Core wallet. Sending is only available after approval.</p>
        {!rpcConfigured && <p className="admin-help" style={{color:'#f5c451'}}>Yerbas RPC is not configured, so approved withdrawals cannot be sent yet.</p>}
        {items.length === 0 ? <p>No withdrawals yet.</p> : items.map((item) => (
          <div className="candidate-row" key={item.id}>
            <div>
              <strong>{(Number(item.amount_atomic) / ATOMIC).toFixed(8)} YERB · {item.display_name || item.username || 'Player'}</strong>
              <span>To {item.destination_address}</span>
              <small>Requested {new Date(item.requested_at).toLocaleString()}{item.reviewed_at ? ` · reviewed ${new Date(item.reviewed_at).toLocaleString()}` : ''}{item.yerbas_address ? ` · login wallet ${item.yerbas_address}` : ''}</small>
              {item.sent_at && <small>Sent {new Date(item.sent_at).toLocaleString()}</small>}
              {item.txid && <small style={{overflowWrap:'anywhere'}}>txid {item.txid}</small>}
              {Number(item.fee_atomic || 0) > 0 && <small>Network fee {(Number(item.fee_atomic) / ATOMIC).toFixed(8)} YERB</small>}
              {item.failure_reason && <small style={{color:'#f5c451'}}>{item.failure_reason}</small>}
            </div>
            <div className="candidate-actions">
              <span className={`status-pill ${item.status}`}>{item.status}</span>
              {item.status === 'requested' && <>
                <button disabled={busy === item.id} onClick={() => action(item.id, 'approve')}>Approve</button>
                <button disabled={busy === item.id} onClick={() => action(item.id, 'reject')}>Reject</button>
              </>}
              {item.status === 'approved' && <button disabled={busy === item.id || !rpcConfigured} onClick={() => action(item.id, 'send')}>{busy === item.id ? 'Sending…' : 'Send YERB'}</button>}
              {item.status === 'processing' && <span>Sending…</span>}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
