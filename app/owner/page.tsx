'use client';

import { useEffect, useMemo, useState } from 'react';
import DispensaryLogoUploader from '@/components/DispensaryLogoUploader';

type SponsorMetrics={pin_impression:number;pin_click:number;listing_view:number;website_click:number;menu_click:number;directions_click:number;game_impression:number;game_completed:number};
type DailyTrend={date:string;total:number}&SponsorMetrics;
type SponsorSummary={business:{id:string;name:string};featured?:{status:string;startsAt:string;endsAt:string;source:string;planCode:string;currency:'USD'}|null;plan:{code:string;name:string;currency:'USD';monthlyPriceCents:number;annualPriceCents:number};metrics:SponsorMetrics;dailyTrend?:DailyTrend[]};
type Owned={locationId:string;verifiedAt:string;location:{id:string;name:string;city?:string;region?:string;country?:string};profile?:{overview?:string;phone?:string;website?:string;hours?:Record<string,string>;amenities?:string[];social?:Record<string,string>};sponsorship?:SponsorSummary|null};

const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const METRICS:[keyof SponsorMetrics,string][]=[['pin_impression','Map impressions'],['pin_click','Pin clicks'],['listing_view','Listing views'],['website_click','Website clicks'],['menu_click','Menu clicks'],['directions_click','Directions'],['game_impression','Game appearances'],['game_completed','Game completions']];
const AMENITY_OPTIONS=['Parking','Delivery','Curbside pickup','In-store pickup','ATM','Wheelchair accessible','Medical','Recreational','Online ordering','Loyalty program','Veteran discount','Senior discount','Debit accepted','Pet friendly'];

function TrendChart({data}:{data:DailyTrend[]}){
  const width=760,height=170,pad=24,max=Math.max(1,...data.map(d=>d.total));
  const points=data.map((d,i)=>`${pad+(i*(width-pad*2))/Math.max(1,data.length-1)},${height-pad-(d.total/max)*(height-pad*2)}`).join(' ');
  const total=data.reduce((sum,d)=>sum+d.total,0);
  return <div style={{border:'1px solid var(--border)',borderRadius:14,padding:'14px 14px 8px',background:'rgba(255,255,255,.015)'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'baseline',marginBottom:8}}><strong>30-day activity</strong><small>{total.toLocaleString()} tracked actions</small></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Sponsor activity over the last 30 days" style={{width:'100%',height:170,display:'block'}}>
      {[0,1,2,3].map(i=><line key={i} x1={pad} x2={width-pad} y1={pad+i*(height-pad*2)/3} y2={pad+i*(height-pad*2)/3} stroke="rgba(255,255,255,.08)" strokeWidth="1"/>)}
      <polyline points={points} fill="none" stroke="#67d66e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
      {data.map((d,i)=>d.total>0?<circle key={d.date} cx={pad+(i*(width-pad*2))/Math.max(1,data.length-1)} cy={height-pad-(d.total/max)*(height-pad*2)} r="4" fill="#67d66e"><title>{new Date(`${d.date}T00:00:00Z`).toLocaleDateString()}: {d.total}</title></circle>:null)}
    </svg>
    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--muted)'}}><span>{data[0]?new Date(`${data[0].date}T00:00:00Z`).toLocaleDateString(undefined,{month:'short',day:'numeric'}):''}</span><span>Today</span></div>
  </div>;
}

function MetricBars({metrics}:{metrics:SponsorMetrics}){
  const max=Math.max(1,...METRICS.map(([key])=>metrics[key]||0));
  return <div style={{display:'grid',gap:8}}>{METRICS.map(([key,label])=>{const value=metrics[key]||0;return <div key={key} style={{display:'grid',gridTemplateColumns:'140px 1fr 52px',gap:10,alignItems:'center',fontSize:12}}><span>{label}</span><div style={{height:9,borderRadius:999,background:'rgba(255,255,255,.07)',overflow:'hidden'}}><div style={{height:'100%',width:`${Math.max(value?4:0,(value/max)*100)}%`,background:'#67d66e',borderRadius:999}}/></div><strong style={{textAlign:'right'}}>{value.toLocaleString()}</strong></div>})}</div>;
}

export default function OwnerPage(){
  const[items,setItems]=useState<Owned[]>([]),[selected,setSelected]=useState(''),[loading,setLoading]=useState(true),[message,setMessage]=useState<string|null>(null),[saving,setSaving]=useState(false);
  const[overview,setOverview]=useState(''),[phone,setPhone]=useState(''),[website,setWebsite]=useState(''),[customAmenities,setCustomAmenities]=useState(''),[selectedAmenities,setSelectedAmenities]=useState<string[]>([]),[hours,setHours]=useState<Record<string,string>>({}),[instagram,setInstagram]=useState(''),[facebook,setFacebook]=useState(''),[x,setX]=useState('');
  const current=useMemo(()=>items.find(i=>i.locationId===selected)||null,[items,selected]);

  const apply=(item:Owned|null)=>{
    setOverview(item?.profile?.overview||'');setPhone(item?.profile?.phone||'');setWebsite(item?.profile?.website||'');
    const existing=item?.profile?.amenities||[];setSelectedAmenities(AMENITY_OPTIONS.filter(option=>existing.includes(option)));setCustomAmenities(existing.filter(value=>!AMENITY_OPTIONS.includes(value)).join(', '));
    setHours(item?.profile?.hours||{});setInstagram(item?.profile?.social?.instagram||'');setFacebook(item?.profile?.social?.facebook||'');setX(item?.profile?.social?.x||'');
  };

  const load=async()=>{setLoading(true);try{const r=await fetch('/api/owner/dispensaries',{cache:'no-store'});if(r.status===401){window.location.href='/account';return;}const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load owner access.');const owned:Owned[]=d.dispensaries||[];setItems(owned);const next=selected&&owned.some(i=>i.locationId===selected)?selected:owned[0]?.locationId||'';setSelected(next);apply(owned.find(i=>i.locationId===next)||null);}catch(e){setMessage(e instanceof Error?e.message:'Could not load owner access.');}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);useEffect(()=>{if(current)apply(current);},[selected]);

  const toggleAmenity=(value:string)=>setSelectedAmenities(current=>current.includes(value)?current.filter(item=>item!==value):[...current,value]);

  async function save(){
    if(!current)return;setSaving(true);setMessage(null);
    try{const amenities=[...selectedAmenities,...customAmenities.split(',').map(v=>v.trim()).filter(Boolean)];const r=await fetch('/api/owner/dispensaries',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({locationId:current.locationId,overview,phone,website,hours,amenities,social:{instagram,facebook,x}})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not save profile.');setMessage('Dispensary profile updated.');await load();}catch(e){setMessage(e instanceof Error?e.message:'Could not save dispensary profile.');}finally{setSaving(false);}
  }

  if(loading)return <main className="owner-shell"><div className="owner-panel">Loading owner workspace…</div></main>;
  const metrics=current?.sponsorship?.metrics;
  const trend=current?.sponsorship?.dailyTrend||[];

  return <main className="owner-shell">
    <header className="owner-header"><div><a href="/">✦ GEOWEEDO</a><span>VERIFIED DISPENSARY OWNER</span><h1>Manage your shop</h1><p>Keep your public listing accurate, see GeoWeedo activity, and manage Featured visibility from one workspace.</p></div><div className="owner-header-actions"><a href="/account">Account</a><a href="/for-dispensaries#featured">Featured</a><a href="/">View map</a></div></header>
    {message&&<div className="owner-message">{message}</div>}
    {items.length===0?<section className="owner-panel"><h2>No verified dispensary yet</h2><p>Your ownership claim may still be under review. Open the dispensary profile to check its claim status or submit a claim.</p><a className="owner-primary" href="/">Find and claim a dispensary</a></section>:<>
      <section className="owner-panel"><label>Managed dispensary<select value={selected} onChange={e=>setSelected(e.target.value)}>{items.map(item=><option key={item.locationId} value={item.locationId}>{item.location.name} · {[item.location.city,item.location.region].filter(Boolean).join(', ')}</option>)}</select></label>{current&&<small>Verified {new Date(current.verifiedAt).toLocaleDateString()}</small>}</section>
      {current&&<>
        <section className="owner-panel">
          <div className="owner-panel-head"><div><span>SPONSOR DASHBOARD · LAST 30 DAYS</span><h2>{current.sponsorship?.featured?.status==='active'?'★ Featured listing':'Standard listing'}</h2></div><a href="/for-dispensaries#featured">Featured details ↗</a></div>
          {current.sponsorship?.featured?<p>Featured {new Date(current.sponsorship.featured.startsAt).toLocaleDateString()} → {new Date(current.sponsorship.featured.endsAt).toLocaleDateString()} · billed/managed in USD.</p>:<p>Claiming and maintaining your business profile is free. GeoWeedo Featured adds enhanced map/discovery visibility and analytics without changing gameplay selection odds.</p>}
          {metrics&&<>
            <div className="owner-grid">{METRICS.map(([key,label])=><div key={key}><strong style={{fontSize:'1.6rem',display:'block'}}>{(metrics[key]||0).toLocaleString()}</strong><span>{label}</span></div>)}</div>
            <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.6fr) minmax(260px,.8fr)',gap:16,marginTop:18}}><TrendChart data={trend}/><div style={{border:'1px solid var(--border)',borderRadius:14,padding:14,background:'rgba(255,255,255,.015)'}}><strong style={{display:'block',marginBottom:12}}>Activity breakdown</strong><MetricBars metrics={metrics}/></div></div>
          </>}
          {current.sponsorship?.plan&&<small style={{display:'block',marginTop:14}}>{current.sponsorship.plan.name}: ${(current.sponsorship.plan.monthlyPriceCents/100).toFixed(0)}/month or ${(current.sponsorship.plan.annualPriceCents/100).toFixed(0)}/year. Sponsorship payments are USD-only.</small>}
        </section>
        <section className="owner-panel owner-form">
          <div className="owner-panel-head"><div><span>PUBLIC PROFILE</span><h2>{current.location.name}</h2></div><a href={`/dispensary/${encodeURIComponent(current.locationId)}`} target="_blank" rel="noreferrer">View public profile ↗</a></div>
          <DispensaryLogoUploader locationId={current.locationId}/>
          <label>Overview<textarea value={overview} onChange={e=>setOverview(e.target.value)} maxLength={5000} placeholder="Tell visitors about the shop, specialties, atmosphere, services, and what makes it useful."/></label>
          <div className="owner-grid"><label>Phone<input value={phone} onChange={e=>setPhone(e.target.value)} maxLength={80}/></label><label>Website<input value={website} onChange={e=>setWebsite(e.target.value)} maxLength={500}/></label></div>
          <fieldset style={{border:'1px solid var(--border)',borderRadius:14,padding:14,margin:0}}><legend style={{padding:'0 7px',fontWeight:800}}>Amenities / services</legend><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8}}>{AMENITY_OPTIONS.map(option=><label key={option} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 10px',border:'1px solid var(--border)',borderRadius:10,cursor:'pointer',background:selectedAmenities.includes(option)?'rgba(103,214,110,.08)':'transparent'}}><input type="checkbox" checked={selectedAmenities.includes(option)} onChange={()=>toggleAmenity(option)}/><span>{option}</span></label>)}</div><label style={{display:'block',marginTop:12}}>Other services<input value={customAmenities} onChange={e=>setCustomAmenities(e.target.value)} placeholder="Separate additional services with commas"/></label></fieldset>
          <div className="owner-hours"><strong>Hours</strong>{DAYS.map(day=><label key={day}><span>{day}</span><input value={hours[day]||''} onChange={e=>setHours(v=>({...v,[day]:e.target.value}))} placeholder="9:00 AM – 9:00 PM"/></label>)}</div>
          <div className="owner-grid"><label>Instagram<input value={instagram} onChange={e=>setInstagram(e.target.value)} placeholder="https://instagram.com/..."/></label><label>Facebook<input value={facebook} onChange={e=>setFacebook(e.target.value)} placeholder="https://facebook.com/..."/></label><label>X / Twitter<input value={x} onChange={e=>setX(e.target.value)} placeholder="https://x.com/..."/></label></div>
          <button className="owner-primary" type="button" disabled={saving} onClick={save}>{saving?'Saving…':'Save public profile'}</button>
        </section>
      </>}
    </>}
  </main>;
}
