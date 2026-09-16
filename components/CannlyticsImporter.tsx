'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type RunStatus = {
  running:boolean;
  pid?:number;
  state?:string;
  dryRun?:boolean;
  limit?:number;
  startedAt?:string;
  completedAt?:string;
  exitCode?:number|null;
  error?:string;
};

type StateSync = {
  state_code:string;
  upstream_records:number|null;
  imported_records:number;
  linked_existing:number;
  unchanged_records:number;
  skipped_records:number;
  failed_records:number;
  last_started_at:string|null;
  last_completed_at:string|null;
  last_error:string|null;
};

type Payload = { status:RunStatus; logTail:string; states:StateSync[] };

const STATE_OPTIONS = [
  ['ca','California'],['co','Colorado'],['ct','Connecticut'],['fl','Florida'],['hi','Hawaii'],
  ['ma','Massachusetts'],['md','Maryland'],['mi','Michigan'],['nv','Nevada'],['ny','New York'],
  ['or','Oregon'],['ri','Rhode Island'],['ut','Utah'],['wa','Washington'],
] as const;

function formatDate(value?:string|null){
  if(!value)return 'Never';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?value:date.toLocaleString();
}

function stateName(code:string){
  return STATE_OPTIONS.find(([id])=>id===code)?.[1]||code.toUpperCase();
}

export default function CannlyticsImporter(){
  const[state,setState]=useState('ny');
  const[limit,setLimit]=useState('');
  const[data,setData]=useState<Payload>({status:{running:false},logTail:'',states:[]});
  const[loading,setLoading]=useState(true);
  const[actionBusy,setActionBusy]=useState(false);
  const[message,setMessage]=useState('');
  const[error,setError]=useState('');

  const refresh=useCallback(async()=>{
    const response=await fetch('/api/admin/cannlytics-import',{cache:'no-store'});
    if(response.status===401){window.location.href='/admin/login';return;}
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||'Could not load Cannlytics status.');
    setData({status:body.status||{running:false},logTail:String(body.logTail||''),states:Array.isArray(body.states)?body.states:[]});
  },[]);

  useEffect(()=>{
    refresh().catch(err=>setError(err instanceof Error?err.message:'Could not load Cannlytics status.')).finally(()=>setLoading(false));
  },[refresh]);

  useEffect(()=>{
    if(!data.status.running)return;
    const timer=window.setInterval(()=>{
      refresh().catch(()=>{});
    },2500);
    return()=>window.clearInterval(timer);
  },[data.status.running,refresh]);

  const selectedSync=useMemo(()=>data.states.find(row=>row.state_code===state)||null,[data.states,state]);

  async function run(dryRun:boolean){
    if(!dryRun&&!window.confirm(`Import / update Cannlytics ${stateName(state)} data in the production GeoWeedo database?`))return;
    setActionBusy(true);setError('');setMessage('');
    try{
      const parsedLimit=Math.max(0,Math.floor(Number(limit||0))||0);
      const response=await fetch('/api/admin/cannlytics-import',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({state,dryRun,limit:parsedLimit}),
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Could not start Cannlytics importer.');
      setData(current=>({...current,status:body.status||current.status}));
      setMessage(`${stateName(state)} ${dryRun?'dry run':'import / update'} started.`);
      await refresh();
    }catch(err){
      setError(err instanceof Error?err.message:'Could not start Cannlytics importer.');
    }finally{
      setActionBusy(false);
    }
  }

  const runLabel=data.status.running
    ? `${stateName(String(data.status.state||''))} ${data.status.dryRun?'dry run':'import'} running`
    : data.status.completedAt
      ? `${data.status.exitCode===0?'✓':'✕'} Last run finished ${formatDate(data.status.completedAt)}`
      : 'Ready';

  return <section className="admin-panel" style={{marginBottom:18}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
      <div>
        <span className="eyebrow">GEOWEEDO FACTS</span>
        <h2 style={{margin:'6px 0'}}>Cannlytics Product &amp; Lab Data</h2>
        <p className="admin-help" style={{maxWidth:760,marginTop:0}}>Import Cannlytics product, batch/COA, cannabinoid, terpene and compliance data directly into GeoWeedo Facts. Existing source records are updated instead of creating a manual review queue.</p>
      </div>
      <strong style={{color:data.status.running?'#f0d37d':'#9aed79'}}>{runLabel}</strong>
    </div>

    {error?<div className="admin-status" style={{margin:'12px 0',borderColor:'#713232',color:'#ffd4d4'}}>{error}</div>:null}
    {message?<div className="admin-status" style={{margin:'12px 0'}}>{message}</div>:null}

    <div className="admin-form" style={{marginTop:14}}>
      <label style={{display:'grid',gap:6}}><strong>State</strong>
        <select value={state} onChange={event=>setState(event.target.value)} disabled={data.status.running||actionBusy}>
          {STATE_OPTIONS.map(([code,label])=><option key={code} value={code}>{label}</option>)}
        </select>
      </label>
      <label style={{display:'grid',gap:6}}><strong>Record limit <small style={{fontWeight:400}}>(optional)</small></strong>
        <input type="number" min="1" max="500000" value={limit} onChange={event=>setLimit(event.target.value)} placeholder="All records" disabled={data.status.running||actionBusy}/>
      </label>
      <div style={{display:'flex',gap:10,alignItems:'end',flexWrap:'wrap'}}>
        <button className="secondary" type="button" disabled={data.status.running||actionBusy} onClick={()=>run(true)}>Dry run</button>
        <button className="primary" type="button" disabled={data.status.running||actionBusy} onClick={()=>run(false)}>Import / update</button>
        <button className="ghost" type="button" disabled={loading||actionBusy} onClick={()=>refresh().catch(err=>setError(err instanceof Error?err.message:'Refresh failed.'))}>Refresh status</button>
      </div>
    </div>

    <div className="source-note" style={{marginTop:16}}>
      <strong>{stateName(state)} status</strong>
      {selectedSync?<span>{Number(selectedSync.imported_records||0).toLocaleString()} source records · {Number(selectedSync.linked_existing||0).toLocaleString()} linked to stronger existing evidence · last completed {formatDate(selectedSync.last_completed_at)}{selectedSync.last_error?` · last error: ${selectedSync.last_error}`:''}</span>:<span>No completed Cannlytics import recorded for this state yet.</span>}
    </div>

    {data.status.running?<div className="source-note" style={{marginTop:10}}><strong>Importer running</strong><span>{stateName(String(data.status.state||''))} · {data.status.dryRun?'dry run':'production import / update'}{data.status.limit?` · limit ${data.status.limit.toLocaleString()}`:''} · started {formatDate(data.status.startedAt)}</span></div>:null}

    {data.logTail?<details style={{marginTop:14}} open={data.status.running}><summary style={{cursor:'pointer',fontWeight:800}}>Importer output</summary><pre style={{marginTop:10,maxHeight:320,overflow:'auto',whiteSpace:'pre-wrap',fontSize:12,padding:12,border:'1px solid var(--line)',borderRadius:10,background:'rgba(0,0,0,.2)'}}>{data.logTail}</pre></details>:null}

    <details style={{marginTop:14}}><summary style={{cursor:'pointer',fontWeight:800}}>All Cannlytics state status</summary><div style={{display:'grid',gap:7,marginTop:10}}>{STATE_OPTIONS.map(([code,label])=>{const row=data.states.find(item=>item.state_code===code);return <div key={code} style={{display:'grid',gridTemplateColumns:'minmax(130px,1fr) 2fr',gap:12,padding:'9px 11px',border:'1px solid var(--line)',borderRadius:9}}><strong>{label}</strong><span style={{fontSize:12,color:'var(--muted)'}}>{row?`${Number(row.imported_records||0).toLocaleString()} records · ${formatDate(row.last_completed_at)}`:'Not imported yet'}</span></div>;})}</div></details>

    <p className="admin-help" style={{marginBottom:0,marginTop:14}}>Source: Cannlytics Cannabis Results Dataset (CC BY 4.0). Production imports use GeoWeedo's safe importer wrapper and preserved raw-source provenance.</p>
  </section>;
}
