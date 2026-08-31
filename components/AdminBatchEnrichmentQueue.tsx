'use client';

import {useEffect,useMemo,useRef,useState} from 'react';

type JobReason={status:string;message:string;count:number};
type Job={id:string;status:string;total:number;counts:Record<string,number>;reasons?:JobReason[];scope:any;auto_apply:number;created_at:string};
type Review={id:string;location_id:string;location_name:string;review_type:'discovery'|'enrichment';confidence:string;score?:number|null;payload:any;created_at:string};
type SearchHealth={configured:boolean;provider:string|null;label:string;ok:boolean;latencyMs:number|null;message:string};
type Data={options:{countries:string[];regions:string[]};jobs:Job[];reviews:Review[];discoveryConfigured?:boolean;discoveryProvider?:{provider:'searxng'|'google'|null;label:string}};
type PendingControl='pause'|'cancel'|null;

function formatValue(value:any){if(value==null||value==='')return '—';if(Array.isArray(value))return value.length?value.join(', '):'—';if(typeof value==='object'){const entries=Object.entries(value);return entries.length?entries.map(([k,v])=>`${k}: ${String(v)}`).join(' · '):'—';}return String(value);}
function sleep(ms:number){return new Promise(resolve=>window.setTimeout(resolve,ms));}

export default function AdminBatchEnrichmentQueue(){
 const[data,setData]=useState<Data>({options:{countries:[],regions:[]},jobs:[],reviews:[]}),[country,setCountry]=useState(''),[region,setRegion]=useState(''),[recordType,setRecordType]=useState('all'),[missing,setMissing]=useState('any'),[autoApply,setAutoApply]=useState(true),[busy,setBusy]=useState(false),[running,setRunning]=useState<string|null>(null),[message,setMessage]=useState(''),[health,setHealth]=useState<SearchHealth|null>(null),[runLimit,setRunLimit]=useState(50),[chunkSize,setChunkSize]=useState(5),[delayMs,setDelayMs]=useState(2000);
 const stopRequestedRef=useRef(false),pendingControlRef=useRef<PendingControl>(null);

 async function load(){const r=await fetch('/api/admin/dispensary-batch-enrichment',{cache:'no-store'});if(r.status===401){location.href='/admin/login';return;}const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load batch enrichment queue.');setData(d);return d as Data;}
 useEffect(()=>{load().catch(e=>setMessage(e instanceof Error?e.message:'Load failed.'));},[]);
 const regions=useMemo(()=>data.options.regions,[data.options.regions]);
 async function post(body:any){const r=await fetch('/api/admin/dispensary-batch-enrichment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Batch operation failed.');return d;}
 async function control(jobId:string,controlAction:'pause'|'resume'|'cancel'){const d=await post({action:'control',jobId,control:controlAction});await load();return d;}

 async function create(){
  setBusy(true);setMessage('Creating enrichment queue…');
  try{
   const d=await post({action:'create',scope:{country:country||undefined,region:region||undefined,recordType,missing},autoApply});
   await load();
   const processable=Number(d.job?.counts?.pending||0),blocked=Number(d.job?.counts?.blocked||0);
   setMessage(`${d.job.total.toLocaleString()} matching records found · ${processable.toLocaleString()} processable${blocked?` · ${blocked.toLocaleString()} blocked until site discovery is configured`:''}.`);
   if(processable)void run(d.job.id);
  }catch(e){setMessage(e instanceof Error?e.message:'Could not create batch.');}
  finally{setBusy(false);}
 }

 async function run(jobId:string){
  if(running)return;
  const ceiling=Math.min(250,Math.max(1,runLimit)),chunk=Math.min(10,Math.max(1,chunkSize)),delay=Math.min(10000,Math.max(0,delayMs));
  stopRequestedRef.current=false;pendingControlRef.current=null;setRunning(jobId);
  setMessage(`Running up to ${ceiling} records · ${chunk} per chunk · ${delay?`${(delay/1000).toFixed(delay%1000?1:0)}s delay`:'no delay'} between chunks.`);
  let processed=0,lastJob:Job|null=null;
  try{
   const resumed=await control(jobId,'resume');lastJob=resumed.job||null;
   if(lastJob?.status==='completed'){setMessage('Batch is already complete.');return;}
   while(processed<ceiling&&!stopRequestedRef.current){
    const requestSize=Math.min(chunk,ceiling-processed);
    const d=await post({action:'process',jobId,chunkSize:requestSize});
    lastJob=d.job||null;
    const completedThisChunk=Number(d.processed||0);
    processed+=completedThisChunk;
    await load();
    if(lastJob?.status==='completed'){const c=lastJob.counts||{};setMessage(`Batch complete · ${c.applied||0} applied · ${c.review||0} awaiting review · ${c.blocked||0} blocked · ${c.failed||0} failed.`);return;}
    if(lastJob?.status==='cancelled'||lastJob?.status==='paused')break;
    if(completedThisChunk<=0){setMessage(`Run stopped after ${processed} records because no pending record advanced.`);break;}
    if(processed<ceiling&&!stopRequestedRef.current&&delay>0)await sleep(delay);
   }
   const requested=pendingControlRef.current;
   if(requested){
    const d=await control(jobId,requested);lastJob=d.job||lastJob;
    setMessage(requested==='cancel'?`Batch cancelled after this run processed ${processed} records.`:`Batch paused after this run processed ${processed} records.`);
   }else if(lastJob?.status!=='completed'&&lastJob?.status!=='cancelled'){
    await control(jobId,'pause');
    setMessage(`Run limit reached: ${processed} record${processed===1?'':'s'} processed. Batch paused safely; Resume starts the next bounded run.`);
   }
  }catch(e){setMessage(e instanceof Error?e.message:'Batch processing stopped.');}
  finally{stopRequestedRef.current=false;pendingControlRef.current=null;setRunning(null);await load().catch(()=>{});}
 }

 async function pause(jobId:string){
  if(running===jobId){stopRequestedRef.current=true;pendingControlRef.current='pause';setMessage('Pause requested. The current chunk will finish, then the batch will stop.');return;}
  setBusy(true);try{await control(jobId,'pause');setMessage('Batch paused.');}catch(e){setMessage(e instanceof Error?e.message:'Could not pause batch.');}finally{setBusy(false);}
 }
 async function cancel(jobId:string){
  if(!window.confirm('Cancel this enrichment batch? Pending records will remain untouched, but the job cannot be resumed.'))return;
  if(running===jobId){stopRequestedRef.current=true;pendingControlRef.current='cancel';setMessage('Cancel requested. The current chunk will finish, then the batch will be cancelled.');return;}
  setBusy(true);try{await control(jobId,'cancel');setMessage('Batch cancelled.');}catch(e){setMessage(e instanceof Error?e.message:'Could not cancel batch.');}finally{setBusy(false);}
 }
 async function testDiscovery(){setBusy(true);setMessage('Testing official-site discovery…');try{const d=await post({action:'health'});setHealth(d.health);setMessage(d.health?.ok?`${d.health.label} is reachable${d.health.latencyMs!=null?` · ${d.health.latencyMs} ms`:''}.`:d.health?.message||'Discovery health check failed.');}catch(e){setHealth(null);setMessage(e instanceof Error?e.message:'Discovery health check failed.');}finally{setBusy(false);}}
 async function retryBlocked(jobId:string){setBusy(true);setMessage('Requeuing blocked records…');try{const d=await post({action:'retryBlocked',jobId});await load();setMessage(`${Number(d.recovery?.requeued||0).toLocaleString()} blocked records requeued.`);}catch(e){setMessage(e instanceof Error?e.message:'Could not requeue blocked records.');}finally{setBusy(false);}}
 async function review(id:string,action:'approve'|'reject'){setBusy(true);try{const r=await fetch('/api/admin/dispensary-batch-enrichment',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewId:id,action})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Review action failed.');await load();setMessage(action==='approve'?'Review approved and applied.':'Review rejected.');}catch(e){setMessage(e instanceof Error?e.message:'Review action failed.');}finally{setBusy(false);}}

 return <section className="admin-panel" style={{marginBottom:24}}>
  <div className="admin-panel-heading"><div><span className="eyebrow">AUTOMATED ENRICHMENT</span><h2>Batch discovery + enrichment queue</h2></div></div>
  <p className="admin-copy">Queue incomplete records safely in bounded runs. Every run has a hard record ceiling, a configurable chunk size, and an optional delay between chunks. Pause and cancel requests wait for the active chunk to finish instead of interrupting a record mid-update.</p>
  {data.discoveryConfigured?<p className="admin-status">Official-site discovery provider: <b>{data.discoveryProvider?.label||'Configured'}</b>. Records missing websites can be discovered automatically before first-party enrichment.</p>:<p className="admin-status">Official-site search is not configured. Set <b>SEARXNG_URL</b> to your self-hosted SearXNG instance. Records that already have websites can still be enriched; records without websites are marked <b>Blocked</b>.</p>}
  <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',margin:'10px 0 14px'}}><button className="ghost" disabled={busy} onClick={()=>void testDiscovery()}>Test discovery</button>{health&&<small><b>{health.ok?'Ready':'Unavailable'}</b> · {health.label}{health.latencyMs!=null?` · ${health.latencyMs} ms`:''} · {health.message}</small>}</div>

  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10}}>
   <label>Country<select value={country} onChange={e=>{setCountry(e.target.value);setRegion('');}}><option value="">All countries</option>{data.options.countries.map(v=><option key={v}>{v}</option>)}</select></label>
   <label>State / region<select value={region} onChange={e=>setRegion(e.target.value)}><option value="">All states / regions</option>{regions.map(v=><option key={v}>{v}</option>)}</select></label>
   <label>Records<select value={recordType} onChange={e=>setRecordType(e.target.value)}><option value="all">Approved + candidates</option><option value="dispensary">Approved dispensaries</option><option value="candidate">Imported candidates</option></select></label>
   <label>Needs<select value={missing} onChange={e=>setMissing(e.target.value)}><option value="any">Any missing information</option><option value="website">Website</option><option value="phone">Phone</option><option value="hours">Hours</option><option value="amenities">Amenities / services</option></select></label>
  </div>

  <div style={{marginTop:14,padding:14,border:'1px solid rgba(255,255,255,.08)',borderRadius:12}}>
   <div><span className="eyebrow">RUN CONTROLS</span></div>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:8}}>
    <label>Records per run<select value={runLimit} onChange={e=>setRunLimit(Number(e.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={250}>250 max</option></select></label>
    <label>Records per chunk<select value={chunkSize} onChange={e=>setChunkSize(Number(e.target.value))}><option value={1}>1</option><option value={3}>3</option><option value={5}>5</option><option value={10}>10 max</option></select></label>
    <label>Delay between chunks<select value={delayMs} onChange={e=>setDelayMs(Number(e.target.value))}><option value={0}>No delay</option><option value={1000}>1 second</option><option value={2000}>2 seconds</option><option value={3000}>3 seconds</option><option value={5000}>5 seconds</option></select></label>
   </div>
   <small style={{display:'block',marginTop:8,opacity:.75}}>A run automatically pauses when it reaches the selected ceiling. Resume starts another bounded run; it never silently rolls into thousands of records.</small>
  </div>

  <div style={{display:'flex',gap:12,alignItems:'center',marginTop:14,flexWrap:'wrap'}}><label style={{display:'flex',gap:7,alignItems:'center'}}><input type="checkbox" checked={autoApply} onChange={e=>setAutoApply(e.target.checked)}/> Auto-apply high-confidence results only</label><button className="primary" disabled={busy||Boolean(running)} onClick={()=>void create()}>Create & run batch</button></div>
  {message&&<p className="admin-status" style={{marginTop:12}}>{message}</p>}

  <h3>Recent batch jobs</h3>
  <div style={{overflowX:'auto'}}><table className="admin-table"><thead><tr><th>Scope</th><th>Status</th><th>Total</th><th>Pending</th><th>Applied</th><th>Review</th><th>Blocked</th><th>Skipped</th><th>Failed</th><th>Controls</th></tr></thead><tbody>{data.jobs.map(j=>{
   const active=running===j.id,terminal=j.status==='completed'||j.status==='cancelled';
   return <tr key={j.id}><td><div>{[j.scope?.country||'All',j.scope?.region,j.scope?.recordType!=='all'?j.scope?.recordType:null,j.scope?.missing].filter(Boolean).join(' · ')}</div>{j.reasons?.length?<div style={{marginTop:5,display:'grid',gap:2}}>{j.reasons.slice(0,3).map((reason,index)=><small key={`${reason.status}-${index}`} style={{opacity:.75}}>{reason.count.toLocaleString()} {reason.status}: {reason.message}</small>)}</div>:null}</td><td><b>{active?'running':j.status}</b></td><td>{j.total}</td><td>{j.counts?.pending||0}</td><td>{j.counts?.applied||0}</td><td>{j.counts?.review||0}</td><td>{j.counts?.blocked||0}</td><td>{j.counts?.skipped||0}</td><td>{j.counts?.failed||0}</td><td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
    {Number(j.counts?.blocked||0)>0&&data.discoveryConfigured&&!terminal&&<button className="ghost" disabled={busy||Boolean(running)} onClick={()=>void retryBlocked(j.id)}>Retry blocked</button>}
    {!terminal&&!active&&<button className="primary" disabled={busy||Boolean(running)} onClick={()=>void run(j.id)}>{j.status==='paused'?'Resume':'Run'}</button>}
    {!terminal&&active&&<button className="ghost" onClick={()=>void pause(j.id)}>Pause</button>}
    {!terminal&&!active&&j.status!=='paused'&&<button className="ghost" disabled={busy||Boolean(running)} onClick={()=>void pause(j.id)}>Pause</button>}
    {!terminal&&<button className="ghost" disabled={busy||(Boolean(running)&&!active)} onClick={()=>void cancel(j.id)}>Cancel</button>}
   </div></td></tr>;
  })}</tbody></table></div>

  <div style={{display:'flex',justifyContent:'space-between',alignItems:'end',gap:10,marginTop:20}}><div><span className="eyebrow">ADMIN REVIEW</span><h3 style={{margin:'4px 0'}}>Uncertain matches</h3></div><strong>{data.reviews.length} pending</strong></div>
  {!data.reviews.length?<p className="admin-copy">No enrichment results currently need manual review.</p>:<div style={{display:'grid',gap:10,marginTop:10}}>{data.reviews.map(r=>{const selected=r.payload?.selected,p=r.payload,changes=Object.entries(p.changes||{});return <div className="admin-card" key={r.id}><div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><strong>{r.location_name}</strong><div><small>{r.review_type==='discovery'?'Official website match':'First-party enrichment'} · {r.confidence} confidence{r.score!=null?` · score ${r.score}`:''}{r.payload?.provider?` · ${String(r.payload.provider)}`:''}{r.payload?.cached?' · cached search':''}</small></div></div><div style={{display:'flex',gap:8}}><button className="ghost" disabled={busy} onClick={()=>void review(r.id,'reject')}>Reject</button><button className="primary" disabled={busy} onClick={()=>void review(r.id,'approve')}>Approve</button></div></div>{r.review_type==='discovery'?<div style={{marginTop:8,display:'grid',gap:5}}><div><b>Candidate:</b> {selected?.url?<a href={selected.url} target="_blank" rel="noreferrer">{selected.url}</a>:'No candidate found'}</div>{selected?.reasons?.length?<div><b>Why matched:</b> {selected.reasons.join(', ')}</div>:null}{selected?.warnings?.length?<div><b>Warnings:</b> {selected.warnings.join(', ')}</div>:null}{r.payload?.runnerUp?<div><b>Runner-up:</b> {r.payload.runnerUp.score} · {r.payload.runnerUp.url}</div>:null}{r.payload?.margin!=null?<div><b>Score margin:</b> {r.payload.margin}</div>:null}{r.payload?.candidates?.slice(1,4).map((c:any)=><div key={c.url}><small>Alternative {c.score}: {c.url}</small></div>)}</div>:<div style={{marginTop:8,display:'grid',gap:8}}><div><b>Source:</b> {p.sourceUrl?<a href={p.sourceUrl} target="_blank" rel="noreferrer">{p.sourceUrl}</a>:'—'}</div>{changes.length?<div style={{display:'grid',gap:6}}><b>Exact changes if approved:</b>{changes.map(([field,change]:[string,any])=><div key={field} style={{padding:'8px 10px',border:'1px solid rgba(255,255,255,.08)',borderRadius:10}}><strong style={{textTransform:'capitalize'}}>{field}</strong><div><small>Current: {formatValue(change.from)}</small></div><div><small>New: {formatValue(change.to)}</small></div></div>)}</div>:<div><b>Exact changes:</b> No stored field would change.</div>}<div><b>Detected phone:</b> {p.phone||'—'} · <b>Website:</b> {p.website||'—'}</div><div><b>Detected hours:</b> {Object.keys(p.hours||{}).length?Object.entries(p.hours).map(([d,h])=>`${d}: ${h}`).join(' · '):'—'}</div><div><b>Detected amenities:</b> {(p.amenities||[]).join(', ')||'—'}</div></div>}</div>})}</div>}
 </section>;
}
