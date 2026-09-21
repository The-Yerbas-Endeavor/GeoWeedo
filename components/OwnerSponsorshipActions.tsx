'use client';

import { useMemo, useState } from 'react';

type Featured={
  status:string;
  startsAt:string;
  endsAt:string;
  source:string;
  planCode:string;
  currency:'USD';
}|null;
type RequestRow={
  id:string;
  requestType:'featured'|'game';
  billingInterval:'monthly'|'annual'|null;
  gameType:'classic'|'daily'|'hunt'|'mission'|null;
  durationCode:'day'|'week'|'month'|'year'|null;
  geographyType:'all'|'country'|'region'|'city'|'radius';
  geographyValue:string|null;
  radiusKm:number|null;
  preferredStartAt:string|null;
  note:string|null;
  status:'pending'|'approved'|'rejected'|'cancelled';
  createdAt:string;
};
type Plan={monthlyPriceCents:number;annualPriceCents:number;name:string};
type Props={
  locationId:string;
  featured:Featured;
  plan:Plan;
  requests:RequestRow[];
  onChanged:()=>Promise<void>|void;
};

const GAME_NAMES={classic:'Classic GeoWeedo',daily:'Daily GeoWeedo',hunt:'GeoWeedo Hunt',mission:'Sponsored Mission'} as const;
function money(cents:number){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);}
function dateInput(date=new Date()){return date.toISOString().slice(0,10);}
function labelRequest(item:RequestRow){
  if(item.requestType==='featured')return 'Featured · '+(item.billingInterval==='annual'?'1 year':'1 month');
  return GAME_NAMES[item.gameType||'classic']+' · '+(item.durationCode||'week');
}
function daysRemaining(value:string){
  const end=Date.parse(value);
  if(!Number.isFinite(end))return null;
  return Math.max(0,Math.ceil((end-Date.now())/86400000));
}

export default function OwnerSponsorshipActions({locationId,featured,plan,requests,onChanged}:Props){
  const[busy,setBusy]=useState('');
  const[message,setMessage]=useState('');
  const[showGame,setShowGame]=useState(false);
  const[gameType,setGameType]=useState<'classic'|'daily'|'hunt'|'mission'>('mission');
  const[durationCode,setDurationCode]=useState<'day'|'week'|'month'|'year'>('week');
  const[geographyType,setGeographyType]=useState<'all'|'country'|'region'|'city'|'radius'>('all');
  const[geographyValue,setGeographyValue]=useState('');
  const[radiusKm,setRadiusKm]=useState('25');
  const[preferredStartAt,setPreferredStartAt]=useState(dateInput());
  const[note,setNote]=useState('');

  const pending=useMemo(()=>requests.filter(item=>item.status==='pending'),[requests]);
  const pendingFeatured=pending.find(item=>item.requestType==='featured');
  const pendingGame=pending.find(item=>item.requestType==='game');
  const remaining=featured?.status==='active'?daysRemaining(featured.endsAt):null;

  async function requestFeatured(interval:'monthly'|'annual'){
    setBusy('featured');setMessage('');
    try{
      const response=await fetch('/api/owner/sponsorships',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        locationId,requestType:'featured',billingInterval:interval,preferredStartAt:featured?.status==='active'?featured.endsAt:new Date().toISOString(),
        note:featured?.status==='active'?'Owner requested Featured extension.':'Owner requested GeoWeedo Featured.',
      })});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Could not submit Featured request.');
      setMessage('Featured request submitted for Admin review.');
      await onChanged();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not submit Featured request.');}
    finally{setBusy('');}
  }

  async function requestGame(){
    setBusy('game');setMessage('');
    try{
      const response=await fetch('/api/owner/sponsorships',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        locationId,requestType:'game',gameType,durationCode,geographyType,
        geographyValue:geographyType==='all'||geographyType==='radius'?null:geographyValue,
        radiusKm:geographyType==='radius'?Number(radiusKm):null,
        preferredStartAt:new Date(preferredStartAt+'T12:00:00').toISOString(),note,
      })});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Could not submit game sponsorship request.');
      setMessage('Game sponsorship request submitted for Admin review.');
      setShowGame(false);setNote('');
      await onChanged();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not submit game sponsorship request.');}
    finally{setBusy('');}
  }

  async function cancelRequest(id:string){
    setBusy(id);setMessage('');
    try{
      const response=await fetch('/api/owner/sponsorships',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:id})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Could not cancel request.');
      setMessage('Sponsorship request cancelled.');
      await onChanged();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not cancel request.');}
    finally{setBusy('');}
  }

  return <div className="owner-sponsor-actions">
    <div className="owner-sponsor-status-row">
      <div>
        <span>SPONSORSHIP STATUS</span>
        <strong className={'owner-sponsor-status '+(featured?.status||'standard')}>
          {featured?.status==='active'?'ACTIVE FEATURED':featured?.status==='expired'?'EXPIRED':featured?.status==='cancelled'?'CANCELLED':'STANDARD LISTING'}
        </strong>
        {featured?.status==='active'&&remaining!==null?<small>{remaining} day{remaining===1?'':'s'} remaining · ends {new Date(featured.endsAt).toLocaleDateString()}</small>:null}
        {featured?.status==='expired'?<small>Ended {new Date(featured.endsAt).toLocaleDateString()}</small>:null}
      </div>
      <div className="owner-sponsor-price">
        <strong>{money(plan.monthlyPriceCents)}<small>/month</small></strong>
        <span>{money(plan.annualPriceCents)}/year</span>
      </div>
    </div>

    <div className="owner-sponsor-benefits"><span>★ Priority gold/star map pin</span><span>↑ Priority Browse & search placement</span><span>◎ Featured profile treatment</span><span>▥ Sponsor analytics</span></div>

    <div className="owner-sponsor-buttons">
      <button type="button" className="owner-primary" disabled={busy!==''||Boolean(pendingFeatured)} onClick={()=>void requestFeatured('monthly')}>
        {pendingFeatured?'Featured request pending':featured?.status==='active'?'Request 1-month extension':'Become Featured · '+money(plan.monthlyPriceCents)}
      </button>
      <button type="button" className="ghost" disabled={busy!==''||Boolean(pendingFeatured)} onClick={()=>void requestFeatured('annual')}>
        {featured?.status==='active'?'Request 1-year extension':'Featured for 1 year · '+money(plan.annualPriceCents)}
      </button>
      <button type="button" className="ghost" disabled={busy!==''||Boolean(pendingGame)} onClick={()=>setShowGame(value=>!value)}>
        {pendingGame?'Game request pending':showGame?'Close game request':'Sponsor a game'}
      </button>
    </div>

    {showGame&&!pendingGame?<div className="owner-game-request">
      <div className="owner-game-request-grid">
        <label>Game<select value={gameType} onChange={event=>setGameType(event.target.value as typeof gameType)}><option value="mission">Sponsored Mission</option><option value="classic">Classic GeoWeedo</option><option value="daily">Daily GeoWeedo</option><option value="hunt">GeoWeedo Hunt</option></select></label>
        <label>Duration<select value={durationCode} onChange={event=>setDurationCode(event.target.value as typeof durationCode)}><option value="day">1 day</option><option value="week">1 week</option><option value="month">1 month</option><option value="year">1 year</option></select></label>
        <label>Preferred start<input type="date" value={preferredStartAt} onChange={event=>setPreferredStartAt(event.target.value)}/></label>
        <label>Audience<select value={geographyType} onChange={event=>setGeographyType(event.target.value as typeof geographyType)}><option value="all">All players</option><option value="country">Country</option><option value="region">State / Province</option><option value="city">City / Region</option><option value="radius">Radius around dispensary</option></select></label>
        {geographyType==='radius'?<label>Radius (km)<input type="number" min="1" step="1" value={radiusKm} onChange={event=>setRadiusKm(event.target.value)}/></label>:geographyType!=='all'?<label>Target<input value={geographyValue} onChange={event=>setGeographyValue(event.target.value)} placeholder={geographyType==='country'?'USA':geographyType==='region'?'California':'San Andreas'}/></label>:null}
      </div>
      <label>Notes for GeoWeedo<textarea value={note} onChange={event=>setNote(event.target.value)} maxLength={1000} placeholder="Optional campaign details, timing, audience or questions."/></label>
      <button type="button" className="owner-primary" disabled={busy!==''} onClick={()=>void requestGame()}>{busy==='game'?'Submitting…':'Submit game sponsorship request'}</button>
      <small>Submitting a request does not activate or bill a sponsorship. GeoWeedo Admin reviews and schedules it first.</small>
    </div>:null}

    {requests.length?<div className="owner-sponsor-requests">
      <strong>Requests</strong>
      {requests.slice(0,6).map(item=><div className="owner-sponsor-request-row" key={item.id}>
        <div><span>{labelRequest(item)}</span><small>Submitted {new Date(item.createdAt).toLocaleDateString()}</small></div>
        <div><b className={'status-pill '+item.status}>{item.status}</b>{item.status==='pending'?<button type="button" className="ghost" disabled={busy!==''} onClick={()=>void cancelRequest(item.id)}>Cancel</button>:null}</div>
      </div>)}
    </div>:null}

    {message?<div className="owner-sponsor-message">{message}</div>:null}
  </div>;
}
