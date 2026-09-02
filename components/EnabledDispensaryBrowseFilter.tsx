'use client';

import { useEffect } from 'react';

type EnabledDispensary={id:string;name:string;latitude:number;longitude:number;city?:string;region?:string};

const normalize=(value:string|undefined)=>String(value||'').trim().toLowerCase();
const identity=(item:EnabledDispensary)=>`${item.id}|${Number(item.latitude).toFixed(6)}|${Number(item.longitude).toFixed(6)}`;
const labelKey=(name:string|undefined,city:string|undefined,region:string|undefined)=>`${normalize(name)}|${normalize(city)}|${normalize(region)}`;

export default function EnabledDispensaryBrowseFilter(){
 useEffect(()=>{
  let cancelled=false;
  let mode:'all'|'enabled'='all';
  let enabled:EnabledDispensary[]=[];
  let timer:number|undefined;

  const enabledIdentities=()=>new Set(enabled.map(identity));
  const enabledLabels=()=>new Set(enabled.map(item=>labelKey(item.name,item.city,item.region)));

  const ensureTabs=(panel:HTMLElement)=>{
   let tabs=panel.querySelector<HTMLElement>('.map-browser-scope-tabs');
   if(tabs)return tabs;
   tabs=document.createElement('div');
   tabs.className='map-browser-scope-tabs';
   tabs.setAttribute('role','tablist');
   tabs.setAttribute('aria-label','Browse dispensary scope');
   tabs.innerHTML='<button type="button" class="active" data-scope="all" role="tab" aria-selected="true">All Locations</button><button type="button" data-scope="enabled" role="tab" aria-selected="false">Enabled</button>';
   const head=panel.querySelector('.map-browser-panel-head');
   if(head)head.insertAdjacentElement('afterend',tabs);
   tabs.addEventListener('click',event=>{
    const target=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-scope]');
    if(!target)return;
    mode=target.dataset.scope==='enabled'?'enabled':'all';
    tabs?.querySelectorAll<HTMLButtonElement>('button[data-scope]').forEach(button=>{
     const active=button.dataset.scope===mode;
     button.classList.toggle('active',active);
     button.setAttribute('aria-selected',active?'true':'false');
    });
    apply();
   });
   return tabs;
  };

  const apply=()=>{
   if(cancelled||!document.querySelector('.map-first-home'))return;
   const panel=document.querySelector<HTMLElement>('.map-browser-panel');
   if(panel)ensureTabs(panel);

   const ids=enabledIdentities();
   const labels=enabledLabels();

   document.querySelectorAll<HTMLElement>('.maplibregl-marker[data-location-identity]').forEach(marker=>{
    if(!marker.dataset.enabledFilterOriginalDisplay)marker.dataset.enabledFilterOriginalDisplay=marker.style.display||'__empty__';
    if(mode==='enabled')marker.style.setProperty('display',ids.has(marker.dataset.locationIdentity||'')?'':'none','important');
    else{
     const original=marker.dataset.enabledFilterOriginalDisplay;
     if(original==='__empty__')marker.style.removeProperty('display');
     else if(original!==undefined)marker.style.display=original;
    }
   });

   let visibleRows=0;
   const visibleStates=new Set<string>();
   document.querySelectorAll<HTMLElement>('.map-browser-state').forEach(section=>{
    const state=section.querySelector<HTMLElement>('.map-browser-state-head strong')?.textContent?.trim()||'';
    let stateVisible=0;
    section.querySelectorAll<HTMLElement>('.map-browser-row').forEach(row=>{
     const name=row.querySelector<HTMLElement>('.map-browser-row-copy strong')?.textContent?.trim()||'';
     const city=row.querySelector<HTMLElement>('.map-browser-row-copy small')?.textContent?.trim()||'';
     const show=mode==='all'||labels.has(labelKey(name,city,state));
     row.style.display=show?'':'none';
     if(show){stateVisible++;visibleRows++;visibleStates.add(state);}
    });
    section.style.display=mode==='enabled'&&stateVisible===0?'none':'';
    const count=section.querySelector<HTMLElement>('.map-browser-state-head small');
    if(count){
     if(!count.dataset.enabledFilterOriginal)count.dataset.enabledFilterOriginal=count.textContent||'';
     count.textContent=mode==='enabled'?`${stateVisible.toLocaleString()} enabled dispensar${stateVisible===1?'y':'ies'}`:count.dataset.enabledFilterOriginal;
    }
   });

   const summary=panel?.querySelector<HTMLElement>('.map-browser-panel-head strong');
   if(summary){
    if(!summary.dataset.enabledFilterOriginal)summary.dataset.enabledFilterOriginal=summary.textContent||'';
    summary.textContent=mode==='enabled'?`${visibleRows.toLocaleString()} enabled · ${visibleStates.size.toLocaleString()} states`:summary.dataset.enabledFilterOriginal;
   }

   const empty=panel?.querySelector<HTMLElement>('.map-browser-empty');
   if(mode==='enabled'&&panel&&!empty&&visibleRows===0){
    const list=panel.querySelector<HTMLElement>('.map-browser-list');
    if(list){const node=document.createElement('div');node.className='map-browser-empty enabled-filter-empty';node.textContent='No enabled dispensaries match the active filters.';list.appendChild(node);}
   }else if(visibleRows>0||mode==='all')panel?.querySelector('.enabled-filter-empty')?.remove();
  };

  fetch('/api/dispensaries',{cache:'no-store'})
   .then(response=>response.ok?response.json():Promise.reject())
   .then(data=>{if(cancelled)return;enabled=Array.isArray(data?.dispensaries)?data.dispensaries:[];apply();})
   .catch(()=>{enabled=[];apply();});

  const observer=new MutationObserver(()=>{
   window.clearTimeout(timer);
   timer=window.setTimeout(apply,30);
  });
  observer.observe(document.body,{subtree:true,childList:true});
  window.addEventListener('resize',apply);
  apply();

  return()=>{cancelled=true;window.clearTimeout(timer);observer.disconnect();window.removeEventListener('resize',apply);};
 },[]);
 return null;
}
