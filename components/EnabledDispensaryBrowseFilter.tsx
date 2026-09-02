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
  const publishScope=()=>{
   document.documentElement.dataset.geoweedoBrowseScope=mode==='enabled'?'listed':'all';
   window.dispatchEvent(new CustomEvent('geoweedo:browse-scope-change',{detail:{scope:mode==='enabled'?'listed':'all'}}));
  };

  const ensureToolbarButton=()=>{
   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');
   if(!tools)return null;
   let button=tools.querySelector<HTMLButtonElement>('.map-enabled-filter-button');
   if(button)return button;
   button=document.createElement('button');
   button.type='button';
   button.className='map-enabled-filter-button';
   button.textContent='Listed';
   button.setAttribute('aria-pressed','false');
   button.title='Show listed dispensaries only';
   const listButton=Array.from(tools.querySelectorAll<HTMLButtonElement>('button')).find(item=>/^(hide list|list \()/i.test((item.textContent||'').trim()));
   if(listButton)tools.insertBefore(button,listButton);else tools.appendChild(button);
   button.addEventListener('click',()=>{
    mode=mode==='enabled'?'all':'enabled';
    button?.classList.toggle('active',mode==='enabled');
    button?.setAttribute('aria-pressed',mode==='enabled'?'true':'false');
    button!.title=mode==='enabled'?'Show all mapped locations':'Show listed dispensaries only';
    publishScope();
    apply();
   });
   return button;
  };

  const removePanelTabs=()=>document.querySelectorAll('.map-browser-scope-tabs').forEach(node=>node.remove());

  const apply=()=>{
   if(cancelled||!document.querySelector('.map-first-home'))return;
   removePanelTabs();
   const control=ensureToolbarButton();
   control?.classList.toggle('active',mode==='enabled');
   control?.setAttribute('aria-pressed',mode==='enabled'?'true':'false');

   const panel=document.querySelector<HTMLElement>('.map-browser-panel');
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
     row.dataset.listedVisible=show?'true':'false';
     if(show){stateVisible++;visibleRows++;visibleStates.add(state);}
    });
    section.style.display=mode==='enabled'&&stateVisible===0?'none':'';
    section.dataset.listedCount=String(stateVisible);
    const count=section.querySelector<HTMLElement>('.map-browser-state-head small');
    if(count){
     if(!count.dataset.enabledFilterOriginal)count.dataset.enabledFilterOriginal=count.textContent||'';
     count.textContent=mode==='enabled'?`${stateVisible.toLocaleString()} listed dispensar${stateVisible===1?'y':'ies'}`:count.dataset.enabledFilterOriginal;
    }
   });

   const summary=panel?.querySelector<HTMLElement>('.map-browser-panel-head strong');
   if(summary){
    if(!summary.dataset.enabledFilterOriginal)summary.dataset.enabledFilterOriginal=summary.textContent||'';
    if(mode==='enabled')summary.textContent=`${visibleRows.toLocaleString()} listed locations · ${visibleStates.size.toLocaleString()} states`;
    else summary.textContent=summary.dataset.enabledFilterOriginal;
   }

   const existingEmpty=panel?.querySelector<HTMLElement>('.enabled-filter-empty');
   if(mode==='enabled'&&panel&&visibleRows===0){
    if(!existingEmpty){
     const list=panel.querySelector<HTMLElement>('.map-browser-list');
     if(list){const node=document.createElement('div');node.className='map-browser-empty enabled-filter-empty';node.textContent='No listed dispensaries match the active filters.';list.appendChild(node);}
    }
   }else existingEmpty?.remove();

   window.dispatchEvent(new CustomEvent('geoweedo:listed-filter-applied',{detail:{scope:mode==='enabled'?'listed':'all',visibleRows,visibleStates:visibleStates.size}}));
  };

  document.documentElement.dataset.geoweedoBrowseScope='all';
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

  return()=>{cancelled=true;window.clearTimeout(timer);observer.disconnect();window.removeEventListener('resize',apply);delete document.documentElement.dataset.geoweedoBrowseScope;};
 },[]);
 return null;
}
