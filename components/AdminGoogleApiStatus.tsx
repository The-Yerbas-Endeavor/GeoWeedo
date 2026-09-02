'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

type UsageRow={usage_date:string;provider:string;request_type:string;request_count:number};
type Status={days:number;provider:string;envDefault:string;mapsKeyConfigured:boolean;placesDedicatedKeyConfigured:boolean;placesAvailable:boolean;placesKeySource:'dedicated'|'maps-fallback'|'missing';warningLimit:number;warning:boolean;usage:{rows:UsageRow[];today:string;googleToday:number;googleImagesToday:number;googleMetadataToday:number};accounting:{source:string;includesGoogleBilling:boolean;note:string}};

function StatusCard({label,value,note,ok}:{label:string;value:string|number;note?:string;ok?:boolean}){
 return <article style={{padding:18,border:'1px solid rgba(255,255,255,.09)',borderRadius:16,background:'#131815',minHeight:132}}><div style={{fontSize:10,fontWeight:900,letterSpacing:'.12em',color:ok===false?'#f5c451':'#67d66e',textTransform:'uppercase'}}>{label}</div><strong style={{display:'block',fontSize:25,marginTop:10,color:'#f4f7f4'}}>{value}</strong>{note&&<div style={{marginTop:8,color:'#9aa69d',fontSize:12,lineHeight:1.45}}>{note}</div>}</article>;
}

export default function AdminGoogleApiStatus(){
 const[target,setTarget]=useState<HTMLElement|null>(null),[days,setDays]=useState(7),[data,setData]=useState<Status|null>(null),[error,setError]=useState('');

 useEffect(()=>{
  if(location.pathname!=='/admin/analytics')return;
  const mount=()=>{
   const main=document.querySelector('main');
   if(!main)return;
   let node=document.getElementById('google-api-analytics-portal') as HTMLElement|null;
   if(!node){node=document.createElement('section');node.id='google-api-analytics-portal';node.style.maxWidth='1500px';node.style.margin='0 auto 40px';const sections=Array.from(main.querySelectorAll(':scope > section')) as HTMLElement[];const before=sections.find(section=>(section.textContent||'').includes('NETWORK TRAFFIC'));if(before)main.insertBefore(node,before);else main.appendChild(node);}
   setTarget(node);
  };
  const timer=window.setTimeout(mount,0);return()=>window.clearTimeout(timer);
 },[]);

 useEffect(()=>{
  if(!target)return;
  setError('');
  fetch(`/api/admin/google-api-status?days=${days}`,{cache:'no-store',headers:{Accept:'application/json'}}).then(async response=>{const body=await response.json().catch(()=>({}));if(response.status===401){location.href='/admin/login';return null;}if(!response.ok)throw new Error(body.error||'Could not load Google API status.');return body as Status;}).then(value=>{if(value)setData(value);}).catch(err=>setError(err instanceof Error?err.message:'Could not load Google API status.'));
 },[target,days]);

 const chart=useMemo(()=>{
  if(!data)return [];
  const byDay=new Map<string,{images:number;metadata:number;other:number}>();
  for(const row of data.usage.rows){if(row.provider!=='google')continue;const item=byDay.get(row.usage_date)||{images:0,metadata:0,other:0};const count=Number(row.request_count||0);if(row.request_type==='image')item.images+=count;else if(row.request_type==='metadata')item.metadata+=count;else item.other+=count;byDay.set(row.usage_date,item);}
  const rows=Array.from(byDay.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  const max=Math.max(1,...rows.map(([,v])=>v.images+v.metadata+v.other));
  return rows.map(([date,v])=>({date,...v,total:v.images+v.metadata+v.other,pct:((v.images+v.metadata+v.other)/max)*100}));
 },[data]);

 if(!target)return null;
 const content=<div><div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:16,marginBottom:16,flexWrap:'wrap'}}><div><span style={{color:'#67d66e',fontSize:11,fontWeight:800,letterSpacing:'.16em'}}>GOOGLE MAPS PLATFORM</span><h2 style={{margin:'5px 0 4px',fontSize:24}}>API usage & status</h2><p style={{margin:0,color:'#9aa69d',fontSize:13}}>Street View and Places configuration plus requests observed by GeoWeedo.</p></div><div style={{display:'flex',gap:7}}>{[1,7,30,90].map(value=><button key={value} type="button" onClick={()=>setDays(value)} style={{padding:'7px 10px',borderRadius:8,border:`1px solid ${days===value?'#67d66e':'rgba(255,255,255,.12)'}`,background:days===value?'rgba(103,214,110,.12)':'#131815',color:'#f4f7f4',cursor:'pointer'}}>{value}d</button>)}</div></div>{error?<div style={{padding:18,border:'1px solid rgba(245,196,81,.28)',borderRadius:16,color:'#f5c451'}}>{error}</div>:!data?<div style={{color:'#9aa69d'}}>Loading Google API status…</div>:<><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}><StatusCard label="Maps API key" value={data.mapsKeyConfigured?'Configured':'Missing'} note="Server-side Street View key" ok={data.mapsKeyConfigured}/><StatusCard label="Places API" value={data.placesKeySource==='dedicated'?'Dedicated key':data.placesKeySource==='maps-fallback'?'Maps-key fallback':'Unavailable'} note="Used for dispensary enrichment" ok={data.placesAvailable}/><StatusCard label="Imagery provider" value={data.provider==='google'?'Google':data.provider==='auto'?'Auto fallback':'KartaView'} note={`Environment default: ${data.envDefault}`}/><StatusCard label="Google requests today" value={data.usage.googleToday.toLocaleString()} note="All tracked Google imagery requests"/><StatusCard label="Street View images" value={data.usage.googleImagesToday.toLocaleString()} note="Image requests today"/><StatusCard label="Metadata lookups" value={data.usage.googleMetadataToday.toLocaleString()} note="Panorama metadata requests today"/><StatusCard label="Warning threshold" value={data.warningLimit>0?data.warningLimit.toLocaleString():'Disabled'} note={data.warningLimit>0?`${Math.round((data.usage.googleImagesToday/data.warningLimit)*100)}% used today`:undefined} ok={!data.warning}/></div><article style={{marginTop:14,padding:20,border:'1px solid rgba(255,255,255,.09)',borderRadius:17,background:'#131815'}}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'baseline',flexWrap:'wrap'}}><div><h3 style={{margin:0,fontSize:18}}>Google request history</h3><p style={{margin:'5px 0 0',fontSize:12,color:'#9aa69d'}}>Tracked Street View requests over the selected period.</p></div><div style={{fontSize:11,color:'#9aa69d'}}>Image <span style={{color:'#67d66e'}}>●</span> · Metadata <span style={{color:'#9fb2a2'}}>●</span></div></div><div style={{display:'grid',gap:9,marginTop:18}}>{chart.length?chart.map(row=><div key={row.date} style={{display:'grid',gridTemplateColumns:'92px 1fr 60px',gap:10,alignItems:'center'}}><span style={{fontSize:11,color:'#9aa69d'}}>{row.date}</span><div style={{height:12,borderRadius:999,background:'rgba(255,255,255,.05)',overflow:'hidden',display:'flex'}}>{row.total>0&&<><span title={`${row.images} images`} style={{width:`${row.total?row.pct*(row.images/row.total):0}%`,background:'#67d66e'}}/><span title={`${row.metadata} metadata`} style={{width:`${row.total?row.pct*(row.metadata/row.total):0}%`,background:'#9fb2a2'}}/><span title={`${row.other} other`} style={{width:`${row.total?row.pct*(row.other/row.total):0}%`,background:'#f5c451'}}/></>}</div><strong style={{fontSize:12,textAlign:'right'}}>{row.total.toLocaleString()}</strong></div>):<div style={{color:'#9aa69d',fontSize:13}}>No Google Street View requests recorded in this period.</div>}</div></article><div style={{marginTop:12,padding:'12px 14px',borderRadius:12,background:'rgba(255,255,255,.025)',color:'#8e9a91',fontSize:11,lineHeight:1.5}}><strong style={{color:'#cbd3cd'}}>Usage scope:</strong> {data.accounting.note}</div></>}</div>;
 return createPortal(content,target);
}
