'use client';

import { useState } from 'react';

type Preset='michigan-cra'|'minnesota-ocm'|'missouri-dhss'|'new-jersey-crc';
const sources:[Preset,string,string][]=[
 ['michigan-cra','Michigan · CRA','Official CRA adult-use licensing reports; Marihuana Retailer licenses only.'],
 ['minnesota-ocm','Minnesota · OCM','Official OCM public license-holder data; issued Cannabis Retailer licenses only.'],
 ['missouri-dhss','Missouri · DHSS','Official Division of Cannabis Regulation licensed dispensary facilities.'],
 ['new-jersey-crc','New Jersey · CRC','Official CRC licensed cannabis businesses authorized for Retailer/Dispensing activity.'],
];
export default function ExpandedOfficialSourceControls(){const[busy,setBusy]=useState<Preset|null>(null),[status,setStatus]=useState('');async function run(preset:Preset,label:string){setBusy(preset);setStatus(`${label}: fetching official data…`);try{const response=await fetch('/api/admin/candidates/fetch-official',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preset})});if(response.status===401){window.location.href='/admin/login';return;}const data=await response.json();if(!response.ok)throw new Error(data.error||`${label} fetch failed.`);setStatus(`${label}: ${data.fetched||0} fetched · ${data.added||0} newly imported · ${Math.max(0,(data.fetched||0)-(data.added||0))} already present/refreshed · ${data.geocoded||0} source records include coordinates.`);window.dispatchEvent(new Event('geoweedo-candidates-updated'));}catch(error){setStatus(error instanceof Error?error.message:`${label} fetch failed.`);}finally{setBusy(null);}}return <section className="admin-panel" style={{marginBottom:18}}><h2>New official state sources</h2><p className="admin-help">These sources are also included automatically in <strong>Fetch all available states</strong> above.</p>{status&&<div className="admin-status" style={{marginBottom:12}}>{status}</div>}{sources.map(([preset,label,description])=><div className="source-note" key={preset}><strong>{label}</strong><span>{description}</span><button className="secondary" disabled={busy!==null} onClick={()=>run(preset,label)}>{busy===preset?'Fetching…':'Fetch now'}</button></div>)}</section>;}
