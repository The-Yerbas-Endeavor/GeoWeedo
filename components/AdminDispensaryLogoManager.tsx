'use client';

import { useEffect, useMemo, useState } from 'react';
import DispensaryLogoUploader from '@/components/DispensaryLogoUploader';

type RecordRow={id:string;name:string;city?:string;region?:string;country?:string;kind?:string};

export default function AdminDispensaryLogoManager(){
 const[rows,setRows]=useState<RecordRow[]>([]),[selected,setSelected]=useState(''),[query,setQuery]=useState(''),[status,setStatus]=useState('Loading dispensaries…');
 useEffect(()=>{fetch('/api/admin/dispensary-records',{cache:'no-store'}).then(async r=>{if(r.status===401){location.href='/admin/login';return null;}const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load dispensaries.');return d;}).then(d=>{if(!d)return;const records:RecordRow[]=d.records||[];setRows(records);setStatus(`${records.length.toLocaleString()} records available.`);}).catch(e=>setStatus(e instanceof Error?e.message:'Could not load dispensaries.'));},[]);
 const matches=useMemo(()=>{const q=query.trim().toLowerCase();if(!q)return rows.slice(0,250);return rows.filter(row=>`${row.name} ${row.city||''} ${row.region||''} ${row.country||''}`.toLowerCase().includes(q)).slice(0,250);},[rows,query]);
 const current=rows.find(row=>row.id===selected)||null;
 return <section className="admin-panel" style={{marginBottom:24}}>
  <div><span className="eyebrow">DISPENSARY BRANDING</span><h2 style={{margin:'4px 0'}}>Custom dispensary logos</h2><p style={{margin:0,color:'var(--muted)'}}>Upload or replace the logo shown on any public dispensary profile. PNG, JPEG and WebP are supported.</p></div>
  <div style={{display:'grid',gridTemplateColumns:'minmax(220px,1fr) minmax(260px,1.3fr)',gap:10,marginTop:16}}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search dispensary, city, state…"/><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select dispensary…</option>{matches.map(row=><option key={`${row.kind||'record'}:${row.id}`} value={row.id}>{row.name} · {[row.city,row.region].filter(Boolean).join(', ')||row.country||row.id}</option>)}</select></div>
  <div className="admin-status" style={{margin:'12px 0'}}>{current?`Branding ${current.name}.`:status}</div>
  {current&&<DispensaryLogoUploader locationId={current.id} compact/>}
 </section>;
}
