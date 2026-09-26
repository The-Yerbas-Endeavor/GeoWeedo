'use client';

import { useEffect, useRef, useState } from 'react';
import AccountWorkspaceTabs from '@/components/AccountWorkspaceTabs';

type Player={id:string;handle:string;email?:string|null;emailLoginEnabled?:boolean};
type OwnedLocation={locationId:string;name:string;city:string;region:string;menuReady:boolean};
type OwnerDashboard={
  locationId:string;locationName:string;city:string;region:string;
  featured:{active:boolean;status:string;endsAt:string|null;metrics30d:{pinImpressions:number;listingViews:number;actions:number}};
  products:{activeItems:number;linkedProducts:number;inStock:number};
  profile:{overview:string;phone:string;website:string;updatedAt:string|null};
};
type Summary={user:Player;ownership?:{verifiedDispensaryOwner:boolean;locations:OwnedLocation[];dashboard?:OwnerDashboard|null}};
type PendingGame={gameId:string;startedAt:string|null;scores:number[];dispensaryIds:string[];potentialYerb:number;savedAt:string};
const PENDING_GAME_KEY='geoweedo_pending_game_reward_v1';

function readPendingGame():PendingGame|null{try{const raw=sessionStorage.getItem(PENDING_GAME_KEY);if(!raw)return null;const value=JSON.parse(raw) as PendingGame;if(!value?.gameId||!Array.isArray(value.scores)||!Array.isArray(value.dispensaryIds)||value.scores.length!==value.dispensaryIds.length)return null;return value;}catch{return null;}}
function clearPendingGame(){try{sessionStorage.removeItem(PENDING_GAME_KEY);}catch{}}

export default function AccountPage(){
  const[mode,setMode]=useState<'email'|'register'>('email');
  const[handle,setHandle]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
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

  return <main className="info-shell">
<AccountWorkspaceTabs/>
    <section className="account-card" style={{marginTop:28}}>
      <div className="account-status">{status}</div>
      {!summary?<>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}><button className={mode==='email'?'primary':'ghost'} onClick={()=>setMode('email')}>Account login</button><button className={mode==='register'?'primary':'ghost'} onClick={()=>setMode('register')}>Create account</button></div>
        {mode==='email'&&<><label>User name or email<input autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary" disabled={busy||!email||!password} onClick={emailLogin}>Sign in</button><p className="account-note">Prefer wallet-signature login? Use the <a href="/account/yerbas">Yerbas tab</a>.</p></>}
        {mode==='register'&&<><label>User name<input value={handle} onChange={e=>setHandle(e.target.value)}/></label><label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label><div aria-hidden="true" style={{position:'absolute',left:'-10000px',width:1,height:1,overflow:'hidden'}}><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></label></div><label>Human check<input inputMode="numeric" autoComplete="off" value={captchaAnswer} onChange={e=>setCaptchaAnswer(e.target.value)} placeholder={captchaQuestion||'Loading anti-spam check…'}/></label><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:12}}><small className="account-note" style={{margin:0}}>{captchaQuestion||'Loading anti-spam check…'}</small><button type="button" className="ghost" disabled={busy} onClick={loadCaptcha}>New question</button></div><button className="primary" disabled={busy||!email||password.length<8||!captchaChallenge||!captchaAnswer.trim()} onClick={register}>Create account</button></>}
      </>:<>
        <div className="verified-card"><strong>✓ {summary.user.handle}</strong><span>{summary.user.email||'GeoWeedo account'}</span><small>Signed in</small></div>
        {summary.ownership?.verifiedDispensaryOwner&&<div className="account-section" style={{border:'1px solid rgba(126,217,87,.35)',background:'rgba(126,217,87,.045)',borderRadius:16,padding:16}}>
          <span className="eyebrow" style={{color:'#8fe36e'}}>VERIFIED DISPENSARY OWNER</span>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'end',flexWrap:'wrap'}}>
            <div><h2 style={{margin:'6px 0 4px'}}>Your dispensary workspace</h2><p className="account-note" style={{margin:0}}>{summary.ownership.dashboard?.locationName||summary.ownership.locations.map(location=>location.name).join(' · ')}</p></div>
            <a className="primary" href="/account/shop" style={{display:'inline-block',textDecoration:'none'}}>Manage shop</a>
          </div>
          {summary.ownership.dashboard?<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginTop:16}}>
            <a href="/account/featured" style={{display:'grid',gap:8,minHeight:180,padding:15,border:'1px solid rgba(255,255,255,.1)',borderRadius:14,background:'rgba(255,255,255,.025)',color:'inherit',textDecoration:'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'start'}}><span className="eyebrow">FEATURED LISTING</span><strong style={{color:summary.ownership.dashboard.featured.active?'#8fe36e':'#d6ddd7'}}>{summary.ownership.dashboard.featured.active?'★ Active':'Standard'}</strong></div>
              <div><strong style={{fontSize:'1.2rem'}}>Featured listing analytics</strong><p className="account-note" style={{margin:'5px 0 0'}}>Last 30 days for {summary.ownership.dashboard.locationName}.</p></div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginTop:'auto'}}>
                <span><strong style={{display:'block',fontSize:'1.15rem'}}>{summary.ownership.dashboard.featured.metrics30d.pinImpressions.toLocaleString()}</strong><small>Pin views</small></span>
                <span><strong style={{display:'block',fontSize:'1.15rem'}}>{summary.ownership.dashboard.featured.metrics30d.listingViews.toLocaleString()}</strong><small>Listing views</small></span>
                <span><strong style={{display:'block',fontSize:'1.15rem'}}>{summary.ownership.dashboard.featured.metrics30d.actions.toLocaleString()}</strong><small>Actions</small></span>
              </div>
              <small style={{color:'#8fe36e',fontWeight:800}}>View analytics →</small>
            </a>

            <a href="/account/products" style={{display:'grid',gap:8,minHeight:180,padding:15,border:'1px solid rgba(255,255,255,.1)',borderRadius:14,background:'rgba(255,255,255,.025)',color:'inherit',textDecoration:'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'start'}}><span className="eyebrow">PRODUCTS & MENU</span><strong>{summary.ownership.dashboard.products.activeItems.toLocaleString()} active</strong></div>
              <div><strong style={{fontSize:'1.2rem'}}>Manage products</strong><p className="account-note" style={{margin:'5px 0 0'}}>Add, scan, edit, remove, price, and update availability for this shop.</p></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:'auto'}}>
                <span><strong style={{display:'block',fontSize:'1.15rem'}}>{summary.ownership.dashboard.products.linkedProducts.toLocaleString()}</strong><small>GeoWeedo linked</small></span>
                <span><strong style={{display:'block',fontSize:'1.15rem'}}>{summary.ownership.dashboard.products.inStock.toLocaleString()}</strong><small>In stock</small></span>
              </div>
              <small style={{color:'#8fe36e',fontWeight:800}}>Manage products →</small>
            </a>

            <a href="/account/shop#public-profile" style={{display:'grid',gap:8,minHeight:180,padding:15,border:'1px solid rgba(255,255,255,.1)',borderRadius:14,background:'rgba(255,255,255,.025)',color:'inherit',textDecoration:'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'start'}}><span className="eyebrow">PUBLIC PROFILE</span><strong style={{color:summary.ownership.dashboard.profile.overview?'#8fe36e':'#e4b86e'}}>{summary.ownership.dashboard.profile.overview?'✓ Added':'Needs description'}</strong></div>
              <div><strong style={{fontSize:'1.2rem'}}>Public profile</strong><p className="account-note" style={{margin:'5px 0 0',display:'-webkit-box',WebkitLineClamp:4,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{summary.ownership.dashboard.profile.overview||'Add a brief shop description so visitors know what makes this dispensary useful, including specialties, atmosphere, accessibility, and services.'}</p></div>
              <small style={{color:'#8fe36e',fontWeight:800,marginTop:'auto'}}>{summary.ownership.dashboard.profile.overview?'Edit public profile →':'Add public profile →'}</small>
            </a>
          </div>:<p className="account-note" style={{marginTop:14}}>Your verified shop is still being connected to its public dispensary record. Open Shop to review its status.</p>}
          {summary.ownership.locations.length>1?<small className="account-note" style={{display:'block',marginTop:12}}>Showing {summary.ownership.dashboard?.locationName||'your primary shop'}. You manage {summary.ownership.locations.length} verified locations; use Shop to switch locations.</small>:null}
        </div>}
        <div className="account-section" style={{display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap'}}>
          <div><h2 style={{marginBottom:4}}>Account settings</h2><p className="account-note" style={{margin:0}}>User name, email, password, signed-in devices, and session controls now live under Login & Security.</p></div>
          <a className="primary" href="/account/security" style={{display:'inline-block',textDecoration:'none'}}>Login & Security</a>
        </div>
      </>}
    </section>
  </main>;
}
