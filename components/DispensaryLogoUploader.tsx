'use client';

import { useEffect, useState } from 'react';

type Logo={path:string;updatedAt?:string}|null;
type Props={locationId:string;compact?:boolean};

export default function DispensaryLogoUploader({locationId,compact=false}:Props){
 const[logo,setLogo]=useState<Logo>(null),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let cancelled=false;setFile(null);setMessage('');fetch(`/api/dispensary-logo?locationId=${encodeURIComponent(locationId)}`,{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(d=>{if(!cancelled)setLogo(d.logo||null);}).catch(()=>{if(!cancelled)setLogo(null);});return()=>{cancelled=true;};},[locationId]);
 async function upload(){if(!file)return;setBusy(true);setMessage('Uploading logo…');try{const form=new FormData();form.set('locationId',locationId);form.set('file',file);const r=await fetch('/api/dispensary-logo',{method:'POST',body:form});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Logo upload failed.');setLogo(d.logo||null);setFile(null);setMessage('Logo saved.');}catch(error){setMessage(error instanceof Error?error.message:'Logo upload failed.');}finally{setBusy(false);}}
 async function remove(){setBusy(true);setMessage('Removing logo…');try{const r=await fetch(`/api/dispensary-logo?locationId=${encodeURIComponent(locationId)}`,{method:'DELETE'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not remove logo.');setLogo(null);setFile(null);setMessage('Logo removed.');}catch(error){setMessage(error instanceof Error?error.message:'Could not remove logo.');}finally{setBusy(false);}}
 return <div className={`dispensary-logo-uploader${compact?' compact':''}`} style={{display:'grid',gridTemplateColumns:compact?'88px 1fr':'112px 1fr',gap:14,alignItems:'center',padding:'14px',border:'1px solid var(--border)',borderRadius:14,background:'rgba(255,255,255,.015)'}}>
  <div style={{width:compact?88:112,height:compact?88:112,borderRadius:14,border:'1px solid var(--border)',background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',padding:8}}>{logo?.path?<img src={`${logo.path}?v=${encodeURIComponent(logo.updatedAt||'1')}`} alt="Current dispensary logo" style={{width:'100%',height:'100%',objectFit:'contain'}}/>:<span style={{color:'#667069',fontSize:11,textAlign:'center',fontWeight:800}}>NO LOGO</span>}</div>
  <div style={{display:'grid',gap:8,minWidth:0}}><div><strong>Custom dispensary logo</strong><div style={{fontSize:12,color:'var(--muted)',marginTop:3}}>PNG, JPEG or WebP · maximum 4 MB. Transparent PNG/WebP works best.</div></div><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)}/><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" className="primary" disabled={busy||!file} onClick={upload}>{busy?'Working…':'Upload logo'}</button>{logo&&<button type="button" className="ghost" disabled={busy} onClick={remove}>Remove logo</button>}</div>{message&&<small style={{color:'var(--muted)'}}>{message}</small>}</div>
 </div>;
}
