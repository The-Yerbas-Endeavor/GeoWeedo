'use client';

import { useEffect, useMemo, useState } from 'react';
import OwnerProductManager from '@/components/OwnerProductManager';

type Owned={locationId:string;verifiedAt:string;location:{id:string;name:string;city?:string;region?:string;country?:string}};

export default function OwnerProductsPage(){
  const[items,setItems]=useState<Owned[]>([]),[selected,setSelected]=useState(''),[loading,setLoading]=useState(true),[message,setMessage]=useState<string|null>(null);
  const current=useMemo(()=>items.find(item=>item.locationId===selected)||null,[items,selected]);

  useEffect(()=>{
    let active=true;
    void (async()=>{
      try{
        const r=await fetch('/api/owner/dispensaries',{cache:'no-store'});
        if(r.status===401){window.location.href='/account';return;}
        const d=await r.json();
        if(!r.ok)throw new Error(d.error||'Could not load owner access.');
        if(!active)return;
        const owned:Owned[]=d.dispensaries||[];
        setItems(owned);setSelected(owned[0]?.locationId||'');
      }catch(e){if(active)setMessage(e instanceof Error?e.message:'Could not load owner access.');}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;};
  },[]);

  if(loading)return <main className="owner-shell"><div className="owner-panel">Loading product workspace…</div></main>;

  return <main className="owner-shell">
    <header className="owner-header"><div><a href="/">✦ GEOWEEDO</a><span>VERIFIED DISPENSARY OWNER</span><h1>Products</h1><p>Add and edit the products your dispensary sells, connect listings to canonical GeoWeedo Products, and keep menu pricing and availability current.</p></div><div className="owner-header-actions"><a href="/owner">Dashboard</a><a href="/account">Account</a><a href="/">View map</a></div></header>
    {message&&<div className="owner-message">{message}</div>}
    {items.length===0?<section className="owner-panel"><h2>No verified dispensary yet</h2><p>A verified ownership claim is required before editing products.</p><a className="owner-primary" href="/">Find and claim a dispensary</a></section>:<>
      <section className="owner-panel"><label>Managed dispensary<select value={selected} onChange={e=>setSelected(e.target.value)}>{items.map(item=><option key={item.locationId} value={item.locationId}>{item.location.name} · {[item.location.city,item.location.region].filter(Boolean).join(', ')}</option>)}</select></label>{current&&<small>Verified {new Date(current.verifiedAt).toLocaleDateString()}</small>}</section>
      {current&&<OwnerProductManager locationId={current.locationId}/>} 
    </>}
  </main>;
}
