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
    let cancelled=false,scheduled=false;
    const heading=(label:string,detail:string)=>{const node=document.createElement('div');node.className=HEADING_CLASS;node.setAttribute('aria-label',label);node.style.cssText='padding:11px 12px 7px;border-top:1px solid var(--line);font-size:11px;font-weight:900;letter-spacing:.1em;color:var(--muted);background:rgba(11,14,12,.94)';node.innerHTML=`<span style="color:var(--text)">${label}</span><small style="display:block;margin-top:3px;font-size:10px;font-weight:600;letter-spacing:.03em;color:var(--muted)">${detail}</small>`;return node;};
    const observer=new MutationObserver(()=>schedule());
    const watch=()=>observer.observe(document.body,{childList:true,subtree:true});
    const partition=()=>{
      if(cancelled)return;const list=document.querySelector('.map-browser-list');if(!list)return;
      observer.disconnect();
      try{
        list.querySelectorAll(`.${HEADING_CLASS}`).forEach(node=>node.remove());
        const sections=Array.from(list.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node.classList.contains('map-browser-state'));
        if(!sections.length)return;
        const listedMode=document.documentElement.dataset.geoweedoBrowseScope==='listed';
        const regionCountry=new Map(regionsRef.current.map(item=>[item.region,item.country||'USA']));
        const buckets=new Map<string,HTMLElement[]>();
        for(const section of sections){
          const region=section.querySelector('.map-browser-state-head strong')?.textContent?.trim()||'';
          const listedCount=Number(section.dataset.listedCount||0);
          if(listedMode&&listedCount<=0)continue;
          const country=regionCountry.get(region)||'USA';const continent=continentFor(country);const key=`${continent}|${country}`;const bucket=buckets.get(key);if(bucket)bucket.push(section);else buckets.set(key,[section]);
        }
        const ordered=Array.from(buckets.entries()).sort(([a],[b])=>{const [ac,an]=a.split('|'),[bc,bn]=b.split('|');const rank=(v:string)=>v==='AMERICAS'?0:v==='EUROPE'?1:2;return rank(ac)-rank(bc)||an.localeCompare(bn);});
        let listedTotal=0;
        for(const [key,items] of ordered){
          const [continent,country]=key.split('|');
          const stats=countriesRef.current.find(item=>item.country===country);
          const fallbackMapped=items.reduce((sum,item)=>sum+Number((item.querySelector('.map-browser-state-head small')?.textContent||'').replace(/[^0-9]/g,'')||0),0);
          const listedCount=items.reduce((sum,item)=>sum+Number(item.dataset.listedCount||0),0);
          if(listedMode)listedTotal+=listedCount;
          const detail=listedMode?`${country} · ${listedCount.toLocaleString()} listed`:`${country} · ${(stats?.mapped??fallbackMapped).toLocaleString()} mapped`;
          list.appendChild(heading(continent,detail));for(const item of items)list.appendChild(item);
        }
        const panelHead=document.querySelector('.map-browser-panel-head strong');
        if(panelHead){
          if(listedMode){const countries=ordered.length;panelHead.textContent=`${listedTotal.toLocaleString()} listed locations · ${countries} countr${countries===1?'y':'ies'}`;}
          else{const mapped=countriesRef.current.reduce((sum,item)=>sum+item.mapped,0);const countries=countriesRef.current.filter(item=>item.mapped>0).length;if(mapped>0)panelHead.textContent=`${mapped.toLocaleString()} mapped locations · ${countries} countr${countries===1?'y':'ies'}`;}
        }
      }finally{if(!cancelled)watch();}
    };
    function schedule(){if(cancelled||scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;partition();});}
    const onScopeChange=()=>schedule();
    fetch('/api/map-candidates',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{if(cancelled)return;regionsRef.current=Array.isArray(data.regions)?data.regions:[];countriesRef.current=Array.isArray(data.countries)?data.countries:[];schedule();}).catch(()=>{});
    window.addEventListener('geoweedo:browse-scope-change',onScopeChange);
    window.addEventListener('geoweedo:listed-filter-applied',onScopeChange);
    watch();schedule();
    return()=>{cancelled=true;observer.disconnect();window.removeEventListener('geoweedo:browse-scope-change',onScopeChange);window.removeEventListener('geoweedo:listed-filter-applied',onScopeChange);};
  },[]);
  return null;
}
