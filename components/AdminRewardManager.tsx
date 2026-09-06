'use client';

import { useEffect, useMemo, useState } from 'react';

type Player = { id: string; handle: string; yerbasAddress: string; walletVerifiedAt?: string; rewardEligible: boolean };
type Reward = { id: string; playerId: string; amountYerb: number; reason: string; reference?: string; status: string; txid?: string; createdAt: string; paidAt?: string };
type RewardPolicy = { enabled: boolean; classicEnabled:boolean; huntEnabled:boolean; dailyEnabled:boolean; yerbPerPoint: number; dailyCapYerb: number; perGameCapYerb: number; reviewRequired: boolean; rewardCooldownMinutes:number; maxRewardedGamesPerDay:number };
const DEFAULT_POLICY: RewardPolicy = { enabled: true, classicEnabled:true, huntEnabled:true, dailyEnabled:true, yerbPerPoint: 0.0004, dailyCapYerb: 25, perGameCapYerb: 10, reviewRequired: true, rewardCooldownMinutes:0, maxRewardedGamesPerDay:0 };

export default function AdminRewardManager() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [playerId, setPlayerId] = useState('');
  const [amount, setAmount] = useState('1');
  const [reason, setReason] = useState('GeoWeedo gameplay reward');
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState('Loading YERB reward ledger…');
  const [policy, setPolicy] = useState<RewardPolicy>(DEFAULT_POLICY);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const playerMap = useMemo(() => new Map(players.map((item) => [item.id, item])), [players]);
  const perfectGameReward = useMemo(() => Math.min(25000 * policy.yerbPerPoint, policy.perGameCapYerb), [policy]);

  async function load() {
    const [rewardResponse, policyResponse] = await Promise.all([
      fetch('/api/admin/rewards', { cache: 'no-store' }),
      fetch('/api/admin/rewards/policy', { cache: 'no-store' }),
    ]);
    if (rewardResponse.status === 401 || policyResponse.status === 401) { window.location.href = '/admin/login'; return; }
    const data = await rewardResponse.json();
    const policyData = await policyResponse.json();
    if (!rewardResponse.ok) throw new Error(data.error || 'Admin access failed.');
    if (!policyResponse.ok) throw new Error(policyData.error || 'Could not load reward policy.');
    setPlayers(data.players || []);
    setRewards((data.rewards || []).slice().reverse());
    setPolicy({...DEFAULT_POLICY,...(policyData.policy || {})});
    setPlayerId((current) => current || data.players?.[0]?.id || '');
    setStatus(`Loaded ${data.rewards?.length || 0} reward ledger entries and ${data.players?.length || 0} verified player records.`);
  }

  useEffect(() => { load().catch((error) => setStatus(error.message)); }, []);

  async function savePolicy() {
    setSavingPolicy(true);
    try {
      const response = await fetch('/api/admin/rewards/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save gameplay reward policy.');
      setPolicy({...DEFAULT_POLICY,...data.policy});
      setStatus(`Gameplay rewards ${data.policy.enabled ? 'enabled' : 'disabled'} · ${data.policy.yerbPerPoint} YERB/point · ${data.policy.rewardCooldownMinutes || 0} min cooldown · ${data.policy.maxRewardedGamesPerDay || 'unlimited'} rewarded games/day.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save gameplay reward policy.');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function queue() {
    const response = await fetch('/api/admin/rewards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId, amountYerb: Number(amount), reason, reference }) });
    const data = await response.json(); if (!response.ok) return setStatus(data.error || 'Could not queue reward.');
    setStatus(`Queued ${data.reward.amountYerb} YERB as ${data.reward.id}.`); setReference(''); await load();
  }

  async function setState(item: Reward, next: string) {
    const response = await fetch('/api/admin/rewards', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, status: next }) });
    const data = await response.json();
    if (!response.ok) return setStatus(data.error || 'Could not update reward.');
    await load();
  }

  async function logout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>YERB reward control</h1></div><div className="admin-links"><a href="/admin/data">Data</a><a href="/admin/dispensaries">Imagery</a><a href="/admin/wallet">Wallet</a><a href="/admin/sponsorships">Sponsorships</a><a href="/">Game</a><button className="ghost" onClick={logout}>Log out</button></div></header>
      <div className="admin-status">{status}</div>

      <section className="admin-panel" style={{marginBottom:20}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:18,alignItems:'flex-start',flexWrap:'wrap'}}>
          <div><span className="eyebrow">GAMEPLAY REWARD POLICY</span><h2 style={{marginTop:6}}>Control rewards and timing</h2><p className="admin-help">Changes apply immediately to server-side reward validation and are recorded in the audit log.</p></div>
          <label style={{display:'flex',gap:10,alignItems:'center',fontWeight:800}}><input type="checkbox" checked={policy.enabled} onChange={(e)=>setPolicy({...policy,enabled:e.target.checked})}/> Gameplay rewards enabled</label>
        </div>

        <div className="admin-grid" style={{marginTop:18}}>
          <div className="admin-form"><label>YERB per point<input type="number" min="0" step="0.00000001" value={policy.yerbPerPoint} onChange={(e)=>setPolicy({...policy,yerbPerPoint:Number(e.target.value)})}/></label><small>Base conversion from points to YERB.</small></div>
          <div className="admin-form"><label>Daily cap per player<input type="number" min="0" step="0.00000001" value={policy.dailyCapYerb} onChange={(e)=>setPolicy({...policy,dailyCapYerb:Number(e.target.value)})}/></label><small>Maximum YERB a player can earn from gameplay per day.</small></div>
          <div className="admin-form"><label>Maximum per game<input type="number" min="0" step="0.00000001" value={policy.perGameCapYerb} onChange={(e)=>setPolicy({...policy,perGameCapYerb:Number(e.target.value)})}/></label><small>Hard cap on a single completed game.</small></div>
          <div className="admin-form"><label style={{display:'flex',gap:10,alignItems:'center'}}><input type="checkbox" checked={policy.reviewRequired} onChange={(e)=>setPolicy({...policy,reviewRequired:e.target.checked})}/> Require reward review</label><small>Hold gameplay rewards for Admin review instead of immediately posting them.</small></div>
        </div>

        <div style={{marginTop:22,borderTop:'1px solid rgba(255,255,255,.08)',paddingTop:20}}>
          <span className="eyebrow">GAME MODES</span>
          <div className="admin-grid" style={{marginTop:12}}>
            <label className="admin-panel" style={{padding:16,display:'flex',gap:10,alignItems:'center'}}><input type="checkbox" checked={policy.classicEnabled} onChange={(e)=>setPolicy({...policy,classicEnabled:e.target.checked})}/><span><strong>🎮 Classic GeoWeedo</strong><small style={{display:'block',marginTop:3}}>Allow Classic games to earn YERB.</small></span></label>
            <label className="admin-panel" style={{padding:16,display:'flex',gap:10,alignItems:'center'}}><input type="checkbox" checked={policy.huntEnabled} onChange={(e)=>setPolicy({...policy,huntEnabled:e.target.checked})}/><span><strong>🌿 Weedo Hunt</strong><small style={{display:'block',marginTop:3}}>Allow successful Hunts to earn YERB.</small></span></label>
            <label className="admin-panel" style={{padding:16,display:'flex',gap:10,alignItems:'center'}}><input type="checkbox" checked={policy.dailyEnabled} onChange={(e)=>setPolicy({...policy,dailyEnabled:e.target.checked})}/><span><strong>🌎 Daily Weedo</strong><small style={{display:'block',marginTop:3}}>Allow Daily challenges to earn YERB when reward submission is enabled.</small></span></label>
          </div>
        </div>

        <div style={{marginTop:22,borderTop:'1px solid rgba(255,255,255,.08)',paddingTop:20}}>
          <span className="eyebrow">REWARD TIMING</span>
          <div className="admin-grid" style={{marginTop:12}}>
            <div className="admin-form"><label>Cooldown between rewarded games (minutes)<input type="number" min="0" step="1" value={policy.rewardCooldownMinutes} onChange={(e)=>setPolicy({...policy,rewardCooldownMinutes:Math.max(0,Math.floor(Number(e.target.value)||0))})}/></label><small>0 = no cooldown. Example: 30 allows one rewarded completion every 30 minutes.</small></div>
            <div className="admin-form"><label>Maximum rewarded games per player / day<input type="number" min="0" step="1" value={policy.maxRewardedGamesPerDay} onChange={(e)=>setPolicy({...policy,maxRewardedGamesPerDay:Math.max(0,Math.floor(Number(e.target.value)||0))})}/></label><small>0 = unlimited. This is separate from the YERB daily amount cap.</small></div>
          </div>
        </div>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,marginTop:18,flexWrap:'wrap'}}><div className="source-note"><strong>Perfect 25,000-point Classic game</strong><span>{policy.enabled && policy.classicEnabled ? `${perfectGameReward.toFixed(8)} YERB maximum` : 'Classic rewards disabled'}</span></div><button className="primary" disabled={savingPolicy} onClick={savePolicy}>{savingPolicy?'Saving…':'Save gameplay reward policy'}</button></div>
      </section>

      <section className="admin-grid">
        <div className="admin-panel">
          <h2>Queue reviewed reward</h2><div className="admin-form"><select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>{players.map((player) => <option value={player.id} key={player.id}>{player.handle} — {player.yerbasAddress}</option>)}</select><input type="number" min="0" step="0.00000001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="YERB amount" /><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" /><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Unique game/reference ID (optional)" /><button className="primary" disabled={!playerId || Number(amount) <= 0} onClick={queue}>Add pending reward</button></div>
        </div>
        <div className="admin-panel"><h2>Unified accounting</h2><div className="source-note"><strong>Pending</strong><span>Validated reward awaiting review.</span></div><div className="source-note"><strong>Held</strong><span>Fraud/duplicate/account check needs attention.</span></div><div className="source-note"><strong>Posted</strong><span>The reward has been credited to the player's internal YERB balance.</span></div><p className="admin-help">Rewards use the same wallet ledger as deposits and withdrawals. Players withdraw posted balances through the reviewed withdrawal flow.</p></div>
      </section>
      <section className="admin-panel approved-list"><h2>Reward entries</h2>{rewards.length === 0 ? <p>No rewards queued yet.</p> : rewards.map((item) => { const player = playerMap.get(item.playerId); return <div className="candidate-row" key={item.id}><div><strong>{item.amountYerb} YERB · {player?.handle || item.playerId}</strong><span>{item.reason}{item.reference ? ` · ${item.reference}` : ''}</span><small>{player?.yerbasAddress || 'No verified address'}</small></div><div className="candidate-actions"><span className={`status-pill ${item.status}`}>{item.status}</span>{item.status === 'pending' && <button onClick={() => setState(item, 'held')}>Hold</button>}{item.status === 'held' && <button onClick={() => setState(item, 'pending')}>Release</button>}{item.status !== 'posted' && item.status !== 'cancelled' && <button onClick={() => setState(item, 'posted')}>Credit balance</button>}</div></div>; })}</section>
    </main>
  );
}
