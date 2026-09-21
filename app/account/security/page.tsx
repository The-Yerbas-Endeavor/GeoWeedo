'use client';

import { useEffect, useMemo, useState } from 'react';
import SiteHeader from '@/components/SiteHeader';
import AccountWorkspaceTabs from '@/components/AccountWorkspaceTabs';

type Session={
  id:string;
  current:boolean;
  userAgent:string;
  createdAt:string|null;
  lastSeenAt:string|null;
  expiresAt:string|null;
};
type SettingsResponse={
  user:{
    id:string;
    handle:string;
    email:string;
    emailLoginEnabled:boolean;
    yerbasAddress:string|null;
    walletVerifiedAt:string|null;
    rewardEligible:boolean;
    accountStatus:string;
    createdAt:string|null;
    updatedAt:string|null;
    lastLoginAt:string|null;
  };
  sessions:Session[];
};

function when(value:string|null){
  if(!value)return '—';
  const time=Date.parse(value);
  return Number.isFinite(time)?new Date(time).toLocaleString():'—';
}
function deviceLabel(value:string){
  const ua=value.toLowerCase();
  const browser=ua.includes('firefox')?'Firefox':ua.includes('edg/')?'Edge':ua.includes('chrome')?'Chrome':ua.includes('safari')?'Safari':'Browser';
  const os=ua.includes('android')?'Android':ua.includes('iphone')||ua.includes('ipad')?'iOS / iPadOS':ua.includes('windows')?'Windows':ua.includes('linux')?'Linux':ua.includes('mac os')?'macOS':'device';
  return browser+' · '+os;
}

export default function AccountSecurityPage(){
  const[data,setData]=useState<SettingsResponse|null>(null);
  const[displayName,setDisplayName]=useState('');
  const[email,setEmail]=useState('');
  const[password,setPassword]=useState('');
  const[confirmPassword,setConfirmPassword]=useState('');
  const[status,setStatus]=useState('Loading account settings…');
  const[busy,setBusy]=useState('');

  async function load(){
    const response=await fetch('/api/account/settings',{cache:'no-store'});
    if(response.status===401){window.location.href='/account';return;}
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||'Could not load account settings.');
    setData(body);
    setDisplayName(body.user?.handle||'');
    setEmail(body.user?.email||'');
    setStatus('');
  }

  useEffect(()=>{void load().catch(error=>setStatus(error instanceof Error?error.message:'Could not load account settings.'));},[]);

  async function patch(action:string,payload:Record<string,unknown>={}){
    setBusy(action);setStatus('');
    try{
      const response=await fetch('/api/account/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Account update failed.');
      await load();
      return body;
    }catch(error){
      setStatus(error instanceof Error?error.message:'Account update failed.');
      return null;
    }finally{setBusy('');}
  }

  async function saveProfile(){
    const result=await patch('profile',{displayName,email});
    if(result)setStatus('Account profile updated.');
  }

  async function savePassword(){
    if(password.length<8){setStatus('Password must be at least 8 characters.');return;}
    if(password!==confirmPassword){setStatus('The new passwords do not match.');return;}
    const result=await patch('password',{password});
    if(result){
      setPassword('');setConfirmPassword('');
      setStatus(result.sessionsRevoked?'Password updated. '+result.sessionsRevoked+' other session'+(result.sessionsRevoked===1?'':'s')+' signed out.':'Password updated.');
    }
  }

  async function revokeOthers(){
    const result=await patch('revoke_other_sessions');
    if(result)setStatus(result.revoked?result.revoked+' other session'+(result.revoked===1?'':'s')+' signed out.':'No other active sessions.');
  }

  async function signOut(){
    setBusy('logout');
    await fetch('/api/account/logout',{method:'POST'});
    window.location.href='/account';
  }

  const otherSessions=useMemo(()=>data?.sessions.filter(session=>!session.current).length||0,[data]);

  return <>
    <SiteHeader/>
    <AccountWorkspaceTabs/>
    <main className="account-security-shell">
      <header className="account-security-hero">
        <span className="eyebrow">LOGIN & SECURITY</span>
        <h2>Account settings</h2>
        <p>Update your GeoWeedo identity, email/password login, and active sessions from one place.</p>
      </header>

      {status&&<div className="owner-message account-security-status">{status}</div>}

      {!data?null:<div className="account-security-grid">
        <section className="account-security-card">
          <div className="account-security-card-head"><div><span>PROFILE</span><h3>User settings</h3></div></div>
          <label>User name<input value={displayName} onChange={event=>setDisplayName(event.target.value)} maxLength={80} autoComplete="username"/></label>
          <label>Email<input type="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com"/></label>
          <button className="primary" disabled={busy!==''||displayName.trim().length<2} onClick={()=>void saveProfile()}>{busy==='profile'?'Saving…':'Save user settings'}</button>
          <dl className="account-security-facts">
            <div><dt>Account status</dt><dd>{data.user.accountStatus}</dd></div>
            <div><dt>Created</dt><dd>{when(data.user.createdAt)}</dd></div>
            <div><dt>Last login</dt><dd>{when(data.user.lastLoginAt)}</dd></div>
          </dl>
        </section>

        <section className="account-security-card">
          <div className="account-security-card-head"><div><span>PASSWORD</span><h3>{data.user.emailLoginEnabled?'Change password':'Enable email/password login'}</h3></div></div>
          {!data.user.email&&<p className="account-note">Add an email address under User settings before relying on email/password login.</p>}
          <label>New password<input type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" placeholder="At least 8 characters"/></label>
          <label>Confirm password<input type="password" value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} autoComplete="new-password"/></label>
          <button className="primary" disabled={busy!==''||password.length<8||password!==confirmPassword} onClick={()=>void savePassword()}>{busy==='password'?'Updating…':'Update password'}</button>
          <p className="account-note">Changing your password signs out every other active session while keeping this device signed in.</p>
        </section>

        <section className="account-security-card account-security-sessions">
          <div className="account-security-card-head">
            <div><span>SESSIONS</span><h3>Signed-in devices</h3></div>
            <button className="ghost" disabled={busy!==''||otherSessions===0} onClick={()=>void revokeOthers()}>{busy==='revoke_other_sessions'?'Signing out…':'Sign out other devices'}</button>
          </div>
          <div className="account-security-session-list">
            {data.sessions.map(session=><article key={session.id} className={session.current?'current':''}>
              <div><strong>{deviceLabel(session.userAgent)}</strong>{session.current&&<span>Current device</span>}</div>
              <small>Last active {when(session.lastSeenAt)} · Expires {when(session.expiresAt)}</small>
              <details><summary>Device details</summary><code>{session.userAgent}</code></details>
            </article>)}
          </div>
        </section>

        <section className="account-security-card">
          <div className="account-security-card-head"><div><span>CONNECTED LOGIN</span><h3>Yerbas identity</h3></div></div>
          <dl className="account-security-facts">
            <div><dt>Verified YERB address</dt><dd className="wrap-value">{data.user.yerbasAddress||'Not connected'}</dd></div>
            <div><dt>Wallet verified</dt><dd>{when(data.user.walletVerifiedAt)}</dd></div>
            <div><dt>Rewards</dt><dd>{data.user.rewardEligible?'Eligible':'Not enabled'}</dd></div>
          </dl>
          <a className="ghost account-security-link" href="/account/yerbas">Open Yerbas settings →</a>
        </section>

        <section className="account-security-card account-security-signout">
          <div><span>SESSION</span><h3>Sign out of GeoWeedo</h3><p className="account-note">Ends the current browser session only.</p></div>
          <button className="secondary" disabled={busy!==''} onClick={()=>void signOut()}>{busy==='logout'?'Signing out…':'Sign out'}</button>
        </section>
      </div>}
    </main>
  </>;
}
