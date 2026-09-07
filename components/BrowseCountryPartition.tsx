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
function sectionCount(section:HTMLElement){
  return Number((section.querySelector('.map-browser-state-head small')?.textContent||'').replace(/[^0-9]/g,'')||0);
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
        const allSections=Array.from(list.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node.classList.contains('map-browser-state'));
        if(!allSections.length)return;
        const displaySelect=document.querySelector<HTMLSelectElement>('.map-first-home .map-browser-tools select[aria-label="Dispensary display"]');
        const scope=displaySelect?.value==='all'?'all':'enabled';
        const regionSelect=document.querySelector<HTMLSelectElement>('.map-first-home .map-browser-tools select[aria-label="Filter by state"]');
        const selectedRegion=String(regionSelect?.value||'all').trim();
        const regionFiltered=selectedRegion!==''&&selectedRegion!=='all';
        const sections=regionFiltered?allSections.filter(section=>(section.querySelector('.map-browser-state-head strong')?.textContent?.trim()||'')===selectedRegion):allSections;
        const regionCountry=new Map(regionsRef.current.map(item=>[item.region,item.country||'USA']));
        const regionMapped=new Map(regionsRef.current.map(item=>[item.region,item.mapped]));
        const buckets=new Map<string,HTMLElement[]>();
        for(const section of sections){
          const region=section.querySelector('.map-browser-state-head strong')?.textContent?.trim()||'';
          const country=regionCountry.get(region)||'USA';const continent=continentFor(country);const key=`${continent}|${country}`;const bucket=buckets.get(key);if(bucket)bucket.push(section);else buckets.set(key,[section]);
        }
        const ordered=Array.from(buckets.entries()).sort(([a],[b])=>{const [ac,an]=a.split('|'),[bc,bn]=b.split('|');const rank=(v:string)=>v==='AMERICAS'?0:v==='EUROPE'?1:2;return rank(ac)-rank(bc)||an.localeCompare(bn);});
        let scopedTotal=0;
        const countriesWithLocations=new Set<string>();
        for(const [key,items] of ordered){
          const [continent,country]=key.split('|');
          let count=0;
          if(scope==='enabled'){
            count=items.reduce((sum,item)=>sum+sectionCount(item),0);
          }else{
            const stats=countriesRef.current.find(item=>item.country===country);
            const fallbackMapped=items.reduce((sum,item)=>sum+sectionCount(item),0);
            const scopedMapped=items.reduce((sum,item)=>{const region=item.querySelector('.map-browser-state-head strong')?.textContent?.trim()||'';return sum+(regionMapped.get(region)??sectionCount(item));},0);
            count=regionFiltered?scopedMapped:(stats?.mapped??fallbackMapped);
          }
          scopedTotal+=count;
          if(count>0)countriesWithLocations.add(country);
          const detail=`${country} · ${count.toLocaleString()} ${scope==='enabled'?'enabled':'mapped'}`;
          list.appendChild(heading(continent,detail));for(const item of items)list.appendChild(item);
        }
        const panelHead=document.querySelector('.map-browser-panel-head strong');
        if(panelHead){
          if(regionFiltered){
            panelHead.textContent=`${scopedTotal.toLocaleString()} ${scope==='enabled'?'enabled dispensar':'mapped location'}${scopedTotal===1?(scope==='enabled'?'y':''):(scope==='enabled'?'ies':'s')} · ${selectedRegion}`;
          }else{
            const countries=countriesWithLocations.size;
            panelHead.textContent=scope==='enabled'
              ?`${scopedTotal.toLocaleString()} enabled dispensaries · ${countries} countr${countries===1?'y':'ies'}`
              :`${scopedTotal.toLocaleString()} mapped locations · ${countries} countr${countries===1?'y':'ies'}`;
          }
        }
      }finally{if(!cancelled)watch();}
    };
    function schedule(){if(cancelled||scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;partition();});}
    const onScopeChange=()=>schedule();
    const onRegionChange=(event:Event)=>{const target=event.target as HTMLSelectElement|null;if(target?.matches('select[aria-label="Filter by state"],select[aria-label="Dispensary display"]'))window.setTimeout(schedule,0);};
    fetch('/api/map-candidates',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{if(cancelled)return;regionsRef.current=Array.isArray(data.regions)?data.regions:[];countriesRef.current=Array.isArray(data.countries)?data.countries:[];schedule();}).catch(()=>{});
    window.addEventListener('geoweedo:browse-scope-change',onScopeChange);
    document.addEventListener('change',onRegionChange,true);
    watch();schedule();
    return()=>{cancelled=true;observer.disconnect();window.removeEventListener('geoweedo:browse-scope-change',onScopeChange);document.removeEventListener('change',onRegionChange,true);};
  },[]);
  return null;
}
