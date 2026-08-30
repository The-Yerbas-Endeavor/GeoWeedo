'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

type RegionStat={region:string;total:number;mapped:number};

export default function LoadedRegionCoveragePortal(){
  const [regions,setRegions]=useState<RegionStat[]>([]);
  const [target,setTarget]=useState<Element|null>(null);

  useEffect(()=>{
    let cancelled=false;
    const load=()=>fetch('/api/map-candidates',{cache:'no-store'})
      .then(response=>response.ok?response.json():Promise.reject())
      .then(data=>{if(!cancelled)setRegions(Array.isArray(data.regions)?data.regions:[]);})
      .catch(()=>{});
    void load();
    const observer=new MutationObserver(()=>setTarget(document.querySelector('.map-browser-list')));
    observer.observe(document.body,{childList:true,subtree:true});
    setTarget(document.querySelector('.map-browser-list'));
    return()=>{cancelled=true;observer.disconnect();};
  },[]);

  const unmapped=useMemo(()=>regions.filter(item=>item.total>0&&item.mapped===0),[regions]);
  if(!target||unmapped.length===0)return null;

  return createPortal(<div className="map-browser-loaded-coverage" style={{borderTop:'1px solid var(--line)'}}>
    <div style={{padding:'10px 12px',fontSize:11,fontWeight:800,letterSpacing:'.08em',color:'var(--muted)'}}>LOADED · AWAITING COORDINATES</div>
    {unmapped.map(item=>{const missing=item.total;return <section className="map-browser-state" key={`coverage-${item.region}`}>
      <div className="map-browser-state-head" style={{cursor:'default'}}>
        <span><strong><i style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:'#8d9690',marginRight:7}}/>{item.region}</strong><small>{item.total.toLocaleString()} loaded · 0 mapped · {missing.toLocaleString()} need coordinates</small></span>
        <b title="No map movement until coordinates are available">○</b>
      </div>
    </section>;})}
  </div>,target);
}
