'use client';

import { useEffect, useState } from 'react';
import SiteHeader from '@/components/SiteHeader';

type Player = { id: string; handle: string; yerbasAddress: string; walletVerifiedAt?: string; rewardEligible: boolean };
type Summary = {
  user: Player;
  wallet: { id: string; currency: string; balanceAtomic: number; heldAtomic: number; availableAtomic: number; balanceYerb: number; availableYerb: number; depositAddress: string | null };
  deposits: Array<{ id: string; txid: string; amount_atomic: number; confirmations: number; status: string; detected_at: string }>;
  withdrawals: Array<{ id: string; destination_address: string; amount_atomic: number; fee_atomic: number; status: string; requested_at: string; txid?: string; failure_reason?: string }>;
};

const ATOMIC = 100_000_000;

export default function AccountPage() {
  const [handle, setHandle] = useState('');
  const [address, setAddress] = useState('');
  const [challenge, setChallenge] = useState('');
  const [signature, setSignature] = useState('');
  const [status, setStatus] = useState('Checking your GeoWeedo account…');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadSummary() {
    const response = await fetch('/api/account/summary', { cache: 'no-store' });
    if (response.status === 401) {
      setSummary(null);
      setStatus('Sign in by proving ownership of a Yerbas address.');
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load account.');
    setSummary(data);
    setHandle(data.user.handle || '');
    setAddress(data.user.yerbasAddress || '');
    setStatus('Yerbas wallet login verified.');
  }

  useEffect(() => { loadSummary().catch((error) => setStatus(error.message)); }, []);

  async function requestChallenge() {
    setBusy(true);
    try {
      const response = await fetch('/api/player/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not create verification message.');
      setChallenge(data.message);
      setStatus('Sign the exact message below with the Yerbas wallet that owns this address, then paste the signature.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Challenge failed.'); }
    finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true);
    try {
      const response = await fetch('/api/player/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle, address, signature }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Wallet verification failed.');
      setChallenge(''); setSignature('');
      await loadSummary();
      setStatus('Signed in. Your GeoWeedo YERB account is ready.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Wallet verification failed.'); }
    finally { setBusy(false); }
  }

  async function createDepositAddress() {
    setBusy(true);
    try {
      const response = await fetch('/api/account/deposit-address', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not generate deposit address.');
      await loadSummary();
      setStatus(data.existing ? 'Using your existing GeoWeedo deposit address.' : 'New GeoWeedo YERB deposit address created.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not generate deposit address.'); }
    finally { setBusy(false); }
  }

  async function requestWithdrawal() {
    if (!window.confirm(`Request withdrawal of ${withdrawAmount} YERB to ${withdrawAddress}?`)) return;
    setBusy(true);
    try {
      const response = await fetch('/api/account/withdrawals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destinationAddress: withdrawAddress, amountYerb: Number(withdrawAmount) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Withdrawal request failed.');
      setWithdrawAmount(''); setWithdrawAddress('');
      await loadSummary();
      setStatus(`Withdrawal ${data.id} is awaiting administrator review.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Withdrawal request failed.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    await fetch('/api/account/logout', { method: 'POST' });
    setSummary(null); setChallenge(''); setSignature(''); setAddress('');
    setStatus('Signed out.');
  }

  return (
    <main className="info-shell">
      <SiteHeader />
      <section className="info-hero compact-hero">
        <span className="eyebrow">PLAYER ACCOUNT</span>
        <h1>GeoWeedo + Yerbas.</h1>
        <p>Wallet-signature login, YERB rewards, deposits and reviewed withdrawals. GeoWeedo never asks for a private key or seed phrase.</p>
      </section>
      <section className="account-card">
        <div className="account-status">{status}</div>

        {!summary ? <>
          <label>Player name<input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Your GeoWeedo name" /></label>
          <label>Yerbas address<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="YERB address" /></label>
          <button className="secondary" disabled={busy || address.length < 20} onClick={requestChallenge}>1. Create login message</button>
          {challenge && <><label>Message to sign<textarea readOnly value={challenge} rows={5} /></label><button className="ghost" onClick={() => navigator.clipboard.writeText(challenge)}>Copy message</button><label>Wallet signature<textarea value={signature} onChange={(e) => setSignature(e.target.value)} rows={4} placeholder="Paste the signature produced by your Yerbas wallet" /></label><button className="primary" disabled={busy || !signature} onClick={verify}>2. Verify & sign in</button></>}
        </> : <>
          <div className="verified-card"><strong>✓ {summary.user.handle}</strong><span>{summary.user.yerbasAddress}</span><small>Wallet verified · reward eligible</small></div>

          <div className="feature-row">
            <div><strong>{summary.wallet.balanceYerb.toFixed(8)}</strong><span>Total YERB balance</span></div>
            <div><strong>{summary.wallet.availableYerb.toFixed(8)}</strong><span>Available YERB</span></div>
            <div><strong>{(summary.wallet.heldAtomic / ATOMIC).toFixed(8)}</strong><span>Held YERB</span></div>
          </div>

          <div className="account-section">
            <h2>Deposit YERB</h2>
            {summary.wallet.depositAddress ? <><div className="verified-card"><strong>Deposit address</strong><span>{summary.wallet.depositAddress}</span></div><button className="ghost" onClick={() => navigator.clipboard.writeText(summary.wallet.depositAddress || '')}>Copy deposit address</button></> : <button className="primary" disabled={busy} onClick={createDepositAddress}>Create deposit address</button>}
            <p className="account-note">Deposits become spendable after the configured confirmation threshold is reached.</p>
          </div>

          <div className="account-section">
            <h2>Withdraw YERB</h2>
            <label>Destination address<input value={withdrawAddress} onChange={(e) => setWithdrawAddress(e.target.value)} placeholder="YERB destination address" /></label>
            <label>Amount<input type="number" min="0" step="0.00000001" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="0.00000000" /></label>
            <button className="primary" disabled={busy || withdrawAddress.length < 20 || Number(withdrawAmount) <= 0} onClick={requestWithdrawal}>Request withdrawal</button>
            <p className="account-note">A request immediately holds the amount from your available balance. An administrator must approve it before the restricted wallet worker can send it.</p>
          </div>

          <div className="account-section">
            <h2>Recent deposits</h2>
            {summary.deposits.length === 0 ? <p className="account-note">No deposits detected yet.</p> : summary.deposits.map((item) => <div className="approved-row" key={item.id}><div><strong>{(Number(item.amount_atomic) / ATOMIC).toFixed(8)} YERB</strong><span>{item.status} · {item.confirmations} confirmations</span><small>{item.txid}</small></div></div>)}
          </div>

          <div className="account-section">
            <h2>Recent withdrawals</h2>
            {summary.withdrawals.length === 0 ? <p className="account-note">No withdrawals requested yet.</p> : summary.withdrawals.map((item) => <div className="approved-row" key={item.id}><div><strong>{(Number(item.amount_atomic) / ATOMIC).toFixed(8)} YERB</strong><span>{item.status} · {item.destination_address}</span>{item.txid && <small>{item.txid}</small>}{item.failure_reason && <small>{item.failure_reason}</small>}</div></div>)}
          </div>

          <button className="secondary" onClick={logout}>Sign out</button>
        </>}
        <p className="account-note">Never paste a private key or seed phrase here. GeoWeedo only uses public addresses, signed login messages and its own restricted server wallet for deposits/withdrawals.</p>
      </section>
    </main>
  );
}
