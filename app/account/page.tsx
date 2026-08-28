'use client';

import { useEffect, useState } from 'react';
import SiteHeader from '@/components/SiteHeader';

type Player = { id: string; handle: string; yerbasAddress: string; walletVerifiedAt?: string; rewardEligible: boolean };

export default function AccountPage() {
  const [handle, setHandle] = useState('');
  const [address, setAddress] = useState('');
  const [challenge, setChallenge] = useState('');
  const [signature, setSignature] = useState('');
  const [status, setStatus] = useState('Verify a Yerbas address to make this player eligible for the reward ledger.');
  const [player, setPlayer] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('geoweedo-player');
      if (saved) setPlayer(JSON.parse(saved));
    } catch {}
  }, []);

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
      setPlayer(data.player);
      localStorage.setItem('geoweedo-player', JSON.stringify(data.player));
      setStatus('Yerbas address verified. This account can now be referenced by the GeoWeedo reward ledger.');
      setSignature('');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Wallet verification failed.'); }
    finally { setBusy(false); }
  }

  return (
    <main className="info-shell">
      <SiteHeader />
      <section className="info-hero compact-hero">
        <span className="eyebrow">PLAYER ACCOUNT</span>
        <h1>Verify your Yerbas wallet.</h1>
        <p>No password or private key is sent to GeoWeedo. You prove ownership by signing a one-time message with your Yerbas wallet.</p>
      </section>
      <section className="account-card">
        <div className="account-status">{status}</div>
        {player?.walletVerifiedAt && <div className="verified-card"><strong>✓ {player.handle}</strong><span>{player.yerbasAddress}</span><small>Reward eligible · verified {new Date(player.walletVerifiedAt).toLocaleString()}</small></div>}
        <label>Player name<input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Your GeoWeedo name" /></label>
        <label>Yerbas address<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="YERB address" /></label>
        <button className="secondary" disabled={busy || address.length < 20} onClick={requestChallenge}>1. Create verification message</button>
        {challenge && <><label>Message to sign<textarea readOnly value={challenge} rows={5} /></label><button className="ghost" onClick={() => navigator.clipboard.writeText(challenge)}>Copy message</button><label>Wallet signature<textarea value={signature} onChange={(e) => setSignature(e.target.value)} rows={4} placeholder="Paste the signature produced by your Yerbas wallet" /></label><button className="primary" disabled={busy || !signature} onClick={verify}>2. Verify address</button></>}
        <p className="account-note">Never paste a private key or seed phrase here. GeoWeedo only needs your public address and signed verification message.</p>
      </section>
    </main>
  );
}
