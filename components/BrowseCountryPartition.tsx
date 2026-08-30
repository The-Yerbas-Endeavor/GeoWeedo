'use client';

import { useEffect, useRef } from 'react';

type RegionStat={region:string;country?:string;total:number;mapped:number};
type CountryStat={country:string;total:number;mapped:number;regions:number};
const HEADING_CLASS='map-browser-country-heading';

function continentFor(country:string){
  if(/netherlands|belgium|germany|france|spain|italy|portugal|united kingdom|ireland|switzerland|austria|denmark|sweden|norway|finland/i.test(country))return 'EUROPE';
  if(/usa|united states|canada|mexico/i.test(country))return 'AMERICAS';
  return 'INTERNATIONAL';
}

export default function BrowseCountryPartition(){
  const regionsRef=useRef<RegionStat[]>([]);
  const countriesRef=useRef<CountryStat[]>([]);
  useEffect(()=>{
    let applying=false,cancelled=false;
    const heading=(label:string,detail:string)=>{const node=document.createElement('div');node.className=HEADING_CLASS;node.setAttribute('aria-label',label);node.style.cssText='padding:11px 12px 7px;border-top:1px solid var(--line);font-size:11px;font-weight:900;letter-spacing:.1em;color:var(--muted);background:rgba(11,14,12,.94)';node.innerHTML=`<span style="color:var(--text)">${label}</span><small style="display:block;margin-top:3px;font-size:10px;font-weight:600;letter-spacing:.03em;color:var(--muted)">${detail}</small>`;return node;};
    const partition=()=>{
      if(applying)return;const list=document.querySelector('.map-browser-list');if(!list)return;applying=true;
      try{
        list.querySelectorAll(`.${HEADING_CLASS}`).forEach(node=>node.remove());
        const sections=Array.from(list.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node.classList.contains('map-browser-state'));
        if(!sections.length)return;
        const regionCountry=new Map(regionsRef.current.map(item=>[item.region,item.country||'USA']));
        const buckets=new Map<string,HTMLElement[]>();
        for(const section of sections){const region=section.querySelector('strong')?.textContent?.trim()||'';const country=regionCountry.get(region)||'USA';const continent=continentFor(country);const key=`${continent}|${country}`;const bucket=buckets.get(key);if(bucket)bucket.push(section);else buckets.set(key,[section]);}
        const ordered=Array.from(buckets.entries()).sort(([a],[b])=>{const [ac,an]=a.split('|'),[bc,bn]=b.split('|');const rank=(v:string)=>v==='AMERICAS'?0:v==='EUROPE'?1:2;return rank(ac)-rank(bc)||an.localeCompare(bn);});
        for(const [key,items] of ordered){const [continent,country]=key.split('|');const stats=countriesRef.current.find(item=>item.country===country);const detail=`${country} · ${(stats?.mapped??items.reduce((sum,item)=>sum+Number((item.querySelector('small')?.textContent||'').replace(/[^0-9]/g,'')||0),0)).toLocaleString()} mapped`;list.appendChild(heading(continent,detail));for(const item of items)list.appendChild(item);}
        const panelHead=document.querySelector('.map-browser-panel-head strong');
        if(panelHead){const mapped=countriesRef.current.reduce((sum,item)=>sum+item.mapped,0);const countries=countriesRef.current.filter(item=>item.mapped>0).length;if(mapped>0)panelHead.textContent=`${mapped.toLocaleString()} mapped locations · ${countries} countr${countries===1?'y':'ies'}`;}
      }finally{applying=false;}
    };
    fetch('/api/map-candidates',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{if(cancelled)return;regionsRef.current=Array.isArray(data.regions)?data.regions:[];countriesRef.current=Array.isArray(data.countries)?data.countries:[];partition();}).catch(()=>{});
    const observer=new MutationObserver(()=>queueMicrotask(partition));observer.observe(document.body,{childList:true,subtree:true});partition();
    return()=>{cancelled=true;observer.disconnect();};
  },[]);
  return null;
}
