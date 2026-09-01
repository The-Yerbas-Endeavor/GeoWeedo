'use client';

import { useEffect, useState } from 'react';

type Candidate={id:string;region?:string};
type DirectPreset='all'|'alaska-amco'|'california-dcc'|'delaware-omc'|'maine-ocp'|'maryland-mca'|'oregon-olcc'|'nevada-ccb'|'washington-lcb'|'connecticut-dcp'|'new-york-ocm'|'montana-dor'|'virginia-cca'|'colorado-med'|'massachusetts-ccc'|'illinois-idfpr';
type SyncDetail={ok:boolean;source:string;fetched:number;added:number;geocoded:number;error?:string};

const directSources:[DirectPreset,string,string][]=[
 ['alaska-amco','Alaska · AMCO','Active-Operating Retail Marijuana Store licenses from Alaska AMCO'],
 ['colorado-med','Colorado · MED','Official Colorado licensed marijuana businesses; retail licenses only'],
 ['delaware-omc','Delaware · OMC','Official Delaware regulated dispensary storefronts serving medical and adult-use customers'],
 ['maine-ocp','Maine · OCP','Official Maine adult-use licensee data; Active Retail Store establishments only'],
 ['maryland-mca','Maryland · MCA','Official Maryland licensed physical dispensaries; delivery-only entries excluded'],
 ['massachusetts-ccc','Massachusetts · CCC','Active adult-use Marijuana Retailer licenses that commenced operations'],
 ['illinois-idfpr','Illinois · IDFPR','Official IDFPR adult-use dispensary PDF parsed into license, name, address, and city records'],
 ['oregon-olcc','Oregon · OLCC','Official OLCC cannabis business license data'],
 ['nevada-ccb','Nevada · CCB','Official Cannabis Compliance Board retail locations'],
 ['washington-lcb','Washington · LCB','Official Washington cannabis renewal open data'],
 ['connecticut-dcp','Connecticut · DCP','Licensed cannabis and medical marijuana retail locations'],
 ['new-york-ocm','New York · OCM','Current OCM licenses filtered to retail/dispensary licenses'],
 ['montana-dor','Montana · DOR','Official licensed dispensary locations'],
 ['virginia-cca','Virginia · CCA','Official Virginia Cannabis Control Authority licensed medical cannabis dispensing locations'],
];

function syncSummary(item:Pick<SyncDetail,'fetched'|'added'|'geocoded'>){
 const existing=Math.max(0,item.fetched-item.added);
 return `${item.fetched} fetched · ${item.added} newly imported · ${existing} already present/refreshed · ${item.geocoded} source records include coordinates`;
}

export default function AdminDataManager(){
 const[file,setFile]=useState<File|null>(null),[source,setSource]=useState('official-license-registry'),[sourceUrl,setSourceUrl]=useState(''),[sourceLicense,setSourceLicense]=useState('official public data'),[status,setStatus]=useState('Loading official licensing data…'),[busy,setBusy]=useState(false),[syncDetails,setSyncDetails]=useState<SyncDetail[]>([]);

 async function load(){
  const response=await fetch('/api/admin/candidates',{cache:'no-store'});
  if(response.status===401){window.location.href='/admin/login';return;}
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Admin access failed.');
  const candidates=(data.candidates||[]) as Candidate[];
  const states=new Set(candidates.map(i=>i.region).filter(Boolean)).size;
  setStatus(`Loaded ${candidates.length} candidate records across ${states} states.`);
 }

 useEffect(()=>{load().catch(e=>setStatus(e instanceof Error?e.message:'Load failed.'));},[]);

 async function upload(){
  if(!file)return setStatus('Choose a CSV or JSON file first.');
  setBusy(true);setSyncDetails([]);
  try{
   const form=new FormData();
   form.set('file',file);form.set('dataSource',source);form.set('sourceUrl',sourceUrl);form.set('sourceLicense',sourceLicense);
   const response=await fetch('/api/admin/candidates/import',{method:'POST',body:form});
   if(response.status===401){window.location.href='/admin/login';return;}
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'Import failed.');
   setStatus(`Parsed ${data.parsed} rows; added ${data.added} new candidates. ${data.total} candidates are queued for Automated Enrichment and Gameplay Pipeline review.`);
  }catch(error){setStatus(error instanceof Error?error.message:'Import failed.');}
  finally{setBusy(false);}
 }

 async function fetchOfficial(preset:DirectPreset,label:string){
  setBusy(true);setSyncDetails([]);setStatus(`${label}: fetching official data…`);
  try{
   const response=await fetch('/api/admin/candidates/fetch-official',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preset})});
   if(response.status===401){window.location.href='/admin/login';return;}
   const data=await response.json();
   const details:Array<SyncDetail>=Array.isArray(data.details)?data.details:[];
   setSyncDetails(details);
   if(!response.ok&&!details.some(i=>i.ok))throw new Error(data.error||data.message||`${label} fetch failed.`);
   if(preset==='all'){
    const succeeded=details.filter(i=>i.ok).length,failed=details.filter(i=>!i.ok).length;
    setStatus(`${data.message||'Nationwide sync complete.'} ${succeeded} succeeded${failed?`, ${failed} failed`:''}. Imported records are ready for Automated Enrichment.`);
   }else{
    setStatus(`${label}: ${syncSummary({fetched:data.fetched||0,added:data.added||0,geocoded:data.geocoded||0})}. Imported records are ready for Automated Enrichment.`);
   }
  }catch(error){setStatus(error instanceof Error?error.message:`${label} fetch failed.`);}
  finally{setBusy(false);}
 }

 async function logout(){await fetch('/api/admin/auth/logout',{method:'POST'});window.location.href='/admin/login';}

 return <main className="admin-shell">
  <header className="admin-header"><div><span className="eyebrow">GEOWEEDO ADMIN</span><h1>Official data import</h1></div><div className="admin-links"><a href="/admin">Control center</a><a href="/admin/dispensaries">Dispensaries</a><a href="/admin/gameplay-pipeline">Gameplay pipeline</a><a href="/">Game</a><button className="ghost" onClick={logout}>Log out</button></div></header>
  <div className="admin-status">{status}</div>

  {syncDetails.length>0&&<section className="admin-panel" style={{marginBottom:18}}><h2 style={{marginTop:0}}>Official sync results</h2><p className="admin-help">“Already present/refreshed” means the fetched license matched a candidate already stored in GeoWeedo and its current official-source details were refreshed. “Source records include coordinates” describes coordinate coverage in the official feed.</p><div style={{display:'grid',gap:8}}>{syncDetails.map(item=><div key={item.source} style={{display:'grid',gridTemplateColumns:'minmax(160px,1fr) auto',gap:14,alignItems:'center',padding:'10px 12px',border:'1px solid var(--line)',borderRadius:10}}><div><strong>{item.ok?'✓':'✕'} {item.source}</strong>{item.error&&<small style={{display:'block',color:'var(--muted)',marginTop:3}}>{item.error}</small>}</div><span style={{fontSize:12,color:'var(--muted)',textAlign:'right'}}>{item.ok?syncSummary(item):'FAILED'}</span></div>)}</div></section>}

  <section className="admin-grid">
   <div className="admin-panel"><h2>Import official CSV / JSON</h2><div className="admin-form"><select value={source} onChange={e=>setSource(e.target.value)}><option value="official-license-registry">Official license registry</option><option value="california-dcc">California DCC</option><option value="state-open-data">Other state open data</option><option value="business-supplied">Business supplied</option></select><input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="Official source URL"/><input value={sourceLicense} onChange={e=>setSourceLicense(e.target.value)} placeholder="Source/license note"/><input type="file" accept=".csv,.json,text/csv,application/json" onChange={e=>setFile(e.target.files?.[0]||null)}/><button className="primary" disabled={busy||!file} onClick={upload}>Import candidates</button></div></div>
   <div className="admin-panel"><h2>Nationwide official-source sync</h2><div className="source-note"><strong>Direct state feeds</strong><span>Fetch every integrated official source one state at a time. Successful imports are kept even if another source fails.</span><button className="primary" disabled={busy} onClick={()=>fetchOfficial('all','Multi-state official sync')}>{busy?'Fetching states…':'Fetch all available states'}</button></div><div className="source-note"><strong>California · DCC</strong><span>Fetch official DCC license-search data and keep active Type 10 storefront retailers only.</span><button className="secondary" disabled={busy} onClick={()=>fetchOfficial('california-dcc','California · DCC')}>Fetch now</button></div>{directSources.filter(([preset])=>preset!=='california-dcc').map(([preset,label,description])=><div className="source-note" key={preset}><strong>{label}</strong><span>{description}</span><button className="secondary" disabled={busy} onClick={()=>fetchOfficial(preset,label)}>Fetch now</button></div>)}</div>
  </section>
 </main>;
}
