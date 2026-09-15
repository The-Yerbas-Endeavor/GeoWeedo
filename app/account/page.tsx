'use client';

import { useEffect, useRef, useState } from 'react';
import SiteHeader from '@/components/SiteHeader';
import AccountWorkspaceTabs from '@/components/AccountWorkspaceTabs';

type Player={id:string;handle:string;email?:string|null;emailLoginEnabled?:boolean};
type OwnedLocation={locationId:string;name:string;city:string;region:string;menuReady:boolean};
type Summary={user:Player;ownership?:{verifiedDispensaryOwner:boolean;locations:OwnedLocation[]}};
type PendingGame={gameId:string;startedAt:string|null;scores:number[];dispensaryIds:string[];potentialYerb:number;savedAt:string};
const PENDING_GAME_KEY='geoweedo_pending_game_reward_v1';

function readPendingGame():PendingGame|null{try{const raw=sessionStorage.getItem(PENDING_GAME_KEY);if(!raw)return null;const value=JSON.parse(raw) as PendingGame;if(!value?.gameId||!Array.isArray(value.scores)||!Array.isArray(value.dispensaryIds)||value.scores.length!==value.dispensaryIds.length)return null;return value;}catch{return null;}}
function clearPendingGame(){try{sessionStorage.removeItem(PENDING_GAME_KEY);}catch{}}

export default function AccountPage(){
  const[mode,setMode]=useState<'email'|'register'>('email');
  const[handle,setHandle]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[accountPassword,setAccountPassword]=useState('');
  const[status,setStatus]=useState('Checking your GeoWeedo account…'),[summary,setSummary]=useState<Summary|null>(null),[busy,setBusy]=useState(false);
  const[captchaQuestion,setCaptchaQuestion]=useState(''),[captchaChallenge,setCaptchaChallenge]=useState(''),[captchaAnswer,setCaptchaAnswer]=useState(''),[website,setWebsite]=useState('');
  const claimInFlight=useRef(false);

  async function loadSummary(){
    const r=await fetch('/api/account/summary',{cache:'no-store'});
    if(r.status===401){setSummary(null);setStatus('Sign in to your GeoWeedo account.');return null;}
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load account.');
    setSummary(d);setHandle(d.user.handle||'');setEmail(d.user.email||'');setStatus('Signed in to your GeoWeedo account.');return d as Summary;
  }
  async function claimPendingGame(){
    if(claimInFlight.current||new URLSearchParams(window.location.search).get('claimGame')!=='1')return false;
    const pending=readPendingGame();if(!pending)return false;claimInFlight.current=true;
    try{const r=await fetch('/api/rewards/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:pending.gameId,startedAt:pending.startedAt,scores:pending.scores,dispensaryIds:pending.dispensaryIds})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not claim this game reward.');clearPendingGame();await loadSummary();setStatus('Completed game claimed. Open the Yerbas tab for reward and wallet details.');window.history.replaceState({},'',window.location.pathname);return true;}catch(e){setStatus(e instanceof Error?e.message:'Could not claim this game reward.');return false;}finally{claimInFlight.current=false;}
  }
  useEffect(()=>{void(async()=>{try{const loaded=await loadSummary();if(new URLSearchParams(window.location.search).get('claimGame')==='1'){if(loaded)await claimPendingGame();else setMode('register');}}catch(e){setStatus(e instanceof Error?e.message:'Could not load account.');}})();},[]);
  async function loadCaptcha(){setCaptchaQuestion('');setCaptchaChallenge('');setCaptchaAnswer('');try{const r=await fetch('/api/account/captcha',{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load anti-spam check.');setCaptchaQuestion(String(d.question||''));setCaptchaChallenge(String(d.challenge||''));}catch(e){setStatus(e instanceof Error?e.message:'Could not load anti-spam check.');}}
  useEffect(()=>{if(mode==='register'&&!summary)void loadCaptcha();},[mode,summary]);
  async function emailLogin(){setBusy(true);try{const r=await fetch('/api/account/email-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:email,password})}),d=await r.json();if(!r.ok)throw new Error(d.error||'Login failed.');setPassword('');await loadSummary();if(!(await claimPendingGame()))setStatus('Signed in successfully.');}catch(e){setStatus(e instanceof Error?e.message:'Login failed.');}finally{setBusy(false);}}
  async function register(){setBusy(true);try{const r=await fetch('/api/account/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:handle,email,password,captchaChallenge,captchaAnswer,website})}),d=await r.json();if(!r.ok)throw new Error(d.error||'Account creation failed.');setPassword('');setCaptchaAnswer('');await loadSummary();if(!(await claimPendingGame()))setStatus('GeoWeedo account created and signed in.');}catch(e){setStatus(e instanceof Error?e.message:'Account creation failed.');await loadCaptcha();}finally{setBusy(false);}}
  async function attachCredentials(){setBusy(true);try{const r=await fetch('/api/account/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:accountPassword})}),d=await r.json();if(!r.ok)throw new Error(d.error||'Could not update login credentials.');setAccountPassword('');await loadSummary();setStatus(d.replaced?'Email/password login updated.':'Email/password login added.');}catch(e){setStatus(e instanceof Error?e.message:'Could not update login credentials.');}finally{setBusy(false);}}
  async function logout(){await fetch('/api/account/logout',{method:'POST'});setSummary(null);setPassword('');setAccountPassword('');setStatus('Signed out.');}

  return <main className="info-shell">
    <SiteHeader/>
    <AccountWorkspaceTabs/>
    <section className="account-card" style={{marginTop:28}}>
      <div className="account-status">{status}</div>
      {!summary?<>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}><button className={mode==='email'?'primary':'ghost'} onClick={()=>setMode('email')}>Account login</button><button className={mode==='register'?'primary':'ghost'} onClick={()=>setMode('register')}>Create account</button></div>
        {mode==='email'&&<><label>User name or email<input autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" disabled={busy||!email||!password} onClick={emailLogin}>Sign in</button><p className="account-note">Prefer wallet-signature login? Use the <a href="/account/yerbas">Yerbas tab</a>.</p></>}
        {mode==='register'&&<><label>User name<input value={handle} onChange={e=>setHandle(e.target.value)}/></label><label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label><div aria-hidden="true" style={{position:'absolute',left:'-10000px',width:1,height:1,overflow:'hidden'}}><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></label></div><label>Human check<input inputMode="numeric" autoComplete="off" value={captchaAnswer} onChange={e=>setCaptchaAnswer(e.target.value)} placeholder={captchaQuestion||'Loading anti-spam check…'}/></label><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:12}}><small className="account-note" style={{margin:0}}>{captchaQuestion||'Loading anti-spam check…'}</small><button type="button" className="ghost" disabled={busy} onClick={loadCaptcha}>New question</button></div><button className="primary" disabled={busy||!email||password.length<8||!captchaChallenge||!captchaAnswer.trim()} onClick={register}>Create account</button></>}
      </>:<>
        <div className="verified-card"><strong>✓ {summary.user.handle}</strong><span>{summary.user.email||'GeoWeedo account'}</span><small>Signed in</small></div>
        {summary.ownership?.verifiedDispensaryOwner&&<div className="account-section" style={{border:'1px solid rgba(126,217,87,.35)',background:'rgba(126,217,87,.07)',borderRadius:14,padding:16}}><span className="eyebrow" style={{color:'#8fe36e'}}>VERIFIED DISPENSARY OWNER</span><h2 style={{marginTop:6}}>Your dispensary workspace</h2><p className="account-note">{summary.ownership.locations.map(location=>location.name).join(' · ')}</p><a className="primary" href="/account/shop" style={{display:'inline-block',textDecoration:'none'}}>Open shop dashboard</a></div>}
        <div className="account-section"><h2>Login & security</h2><p className="account-note">Manage the email and password used for your GeoWeedo account.</p><label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label><label>{summary.user.emailLoginEnabled?'New password':'Password'}<input type="password" autoComplete="new-password" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)} placeholder="At least 8 characters"/></label><button className="primary" disabled={busy||!email||accountPassword.length<8} onClick={attachCredentials}>{summary.user.emailLoginEnabled?'Update email/password':'Add email/password login'}</button></div>
        <button className="secondary" onClick={logout}>Sign out</button>
      </>}
    </section>
  </main>;
}
