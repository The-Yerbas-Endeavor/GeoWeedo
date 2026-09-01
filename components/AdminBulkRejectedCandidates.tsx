'use client';

import {useEffect,useState} from 'react';

export default function AdminBulkRejectedCandidates(){
 const[count,setCount]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function refresh(){const r=await fetch('/api/admin/candidates',{cache:'no-store'});if(r.status===401){window.location.href='/admin/login';return;}const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not load candidates.');setCount((d.candidates||[]).filter((item:any)=>item.status==='rejected').length);}
 useEffect(()=>{refresh().catch(e=>setMessage(e instanceof Error?e.message:'Could not load rejected candidates.'));},[]);
 async function deleteAll(){if(!count)return;if(!window.confirm(`Permanently delete all ${count.toLocaleString()} rejected candidates? This cannot be undone.`))return;setBusy(true);setMessage(`Deleting ${count.toLocaleString()} rejected candidates…`);try{const r=await fetch('/api/admin/candidates',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({allRejected:true})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Bulk delete failed.');setMessage(`${Number(d.count||0).toLocaleString()} rejected candidates permanently deleted.`);await refresh();window.dispatchEvent(new Event('geoweedo-candidates-updated'));window.location.reload();}catch(e){setMessage(e instanceof Error?e.message:'Bulk delete failed.');}finally{setBusy(false);}}
 if(!count&&!message)return null;
 return <section className="admin-panel" style={{marginBottom:18}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:14,flexWrap:'wrap'}}><div><span className="eyebrow">REJECTED CANDIDATES</span><h3 style={{margin:'4px 0'}}>{count.toLocaleString()} rejected</h3><div className="admin-copy">Permanently remove rejected candidates from the imported candidate database.</div></div><button className="ghost" disabled={busy||count===0} onClick={()=>void deleteAll()}>{busy?'Deleting…':`Delete all ${count.toLocaleString()} rejected`}</button></div>{message&&<p className="admin-status" style={{marginTop:12}}>{message}</p>}</section>;
}
