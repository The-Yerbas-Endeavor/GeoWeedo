'use client';

import { useEffect } from 'react';

type ListedDispensary={id:string;name:string;latitude:number;longitude:number;city?:string;region?:string;country?:string};
type BrowseScope='all'|'listed';

const normalize=(value:string|undefined)=>String(value||'').trim().toLowerCase();
const identity=(item:ListedDispensary)=>`${item.id}|${Number(item.latitude).toFixed(6)}|${Number(item.longitude).toFixed(6)}`;
const labelKey=(name:string|undefined,city:string|undefined,region:string|undefined)=>`${normalize(name)}|${normalize(city)}|${normalize(region)}`;

export default function EnabledDispensaryBrowseFilter(){
 useEffect(()=>{
  let cancelled=false;
  let scope:BrowseScope='all';
  let listed:ListedDispensary[]=[];
  let timer:number|undefined;

  const publishScope=()=>{
   document.documentElement.dataset.geoweedoBrowseScope=scope;
   window.dispatchEvent(new CustomEvent('geoweedo:browse-scope-change',{detail:{scope}}));
  };

  const syncListToggle=()=>{
   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');
   if(!tools)return;
   const listButton=Array.from(tools.querySelectorAll<HTMLButtonElement>('button')).find(item=>/^(hide list|list \()/i.test((item.textContent||'').trim()));
   if(!listButton)return;
   const isHide=/^hide list$/i.test((listButton.textContent||'').trim());
   listButton.style.display=isHide?'none':'';
   listButton.setAttribute('aria-hidden',isHide?'true':'false');
   listButton.tabIndex=isHide?-1:0;
  };

  const ensureScopeSelect=()=>{
   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');
   if(!tools)return null;

   tools.querySelector('.map-enabled-filter-button')?.remove();

   let select=tools.querySelector<HTMLSelectElement>('.map-scope-filter-select');
   if(select){
    if(select.value!==scope)select.value=scope;
    return select;
   }

   select=document.createElement('select');
   select.className='map-scope-filter-select';
   select.setAttribute('aria-label','Dispensary map scope');
   select.title='Choose which dispensary locations to show';

   const allOption=document.createElement('option');
   allOption.value='all';
   allOption.textContent='All';
   select.appendChild(allOption);

   const listedOption=document.createElement('option');
   listedOption.value='listed';
   listedOption.textContent='Listed';
   select.appendChild(listedOption);

   select.value=scope;
   select.addEventListener('change',()=>{
    scope=select!.value==='listed'?'listed':'all';
    publishScope();
    apply();
   });

   const listButton=Array.from(tools.querySelectorAll<HTMLButtonElement>('button')).find(item=>/^(hide list|list \()/i.test((item.textContent||'').trim()));
   if(listButton)tools.insertBefore(select,listButton);else tools.appendChild(select);
   return select;
  };

  const removePanelTabs=()=>document.querySelectorAll('.map-browser-scope-tabs').forEach(node=>node.remove());

  const apply=()=>{
   if(cancelled||!document.querySelector('.map-first-home'))return;
   removePanelTabs();
   syncListToggle();
   const control=ensureScopeSelect();
   if(control&&control.value!==scope)control.value=scope;

   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');
   const regionSelect=tools?.querySelector<HTMLSelectElement>('select[aria-label="Filter by state"]');
   const selectedRegion=String(regionSelect?.value||'all').trim();
   const regionFiltered=selectedRegion&&selectedRegion!=='all';
   const listedInScope=regionFiltered?listed.filter(item=>String(item.region||'').trim()===selectedRegion):listed;

   const listedOnly=scope==='listed';
   const panel=document.querySelector<HTMLElement>('.map-browser-panel');
   const listedIds=new Set(listed.map(identity));
   const listedLabels=new Set(listed.map(item=>labelKey(item.name,item.city,item.region)));
   const regionCounts=new Map<string,number>();
   const countries=new Set<string>();
   for(const item of listedInScope){
    const region=String(item.region||'').trim();
    if(region)regionCounts.set(region,(regionCounts.get(region)||0)+1);
    countries.add(String(item.country||'USA').trim()||'USA');
   }

   document.querySelectorAll<HTMLElement>('.maplibregl-marker[data-location-identity]').forEach(marker=>{
    if(!marker.dataset.enabledFilterOriginalDisplay)marker.dataset.enabledFilterOriginalDisplay=marker.style.display||'__empty__';
    if(listedOnly)marker.style.setProperty('display',listedIds.has(marker.dataset.locationIdentity||'')?'':'none','important');
    else{
     const original=marker.dataset.enabledFilterOriginalDisplay;
     if(original==='__empty__')marker.style.removeProperty('display');
     else if(original!==undefined)marker.style.display=original;
    }
   });

   document.querySelectorAll<HTMLElement>('.map-browser-state').forEach(section=>{
    const state=section.querySelector<HTMLElement>('.map-browser-state-head strong')?.textContent?.trim()||'';
    const stateCount=listed.filter(item=>String(item.region||'').trim()===state).length;
    section.dataset.listedCount=String(stateCount);
    section.style.display=listedOnly&&stateCount===0?'none':'';

    section.querySelectorAll<HTMLElement>('.map-browser-row').forEach(row=>{
     if(!listedOnly){row.style.display='';row.dataset.listedVisible='true';return;}
     const name=row.querySelector<HTMLElement>('.map-browser-row-copy strong')?.textContent?.trim()||'';
     const city=row.querySelector<HTMLElement>('.map-browser-row-copy small')?.textContent?.trim()||'';
     const show=listedLabels.has(labelKey(name,city,state));
     row.style.display=show?'':'none';
     row.dataset.listedVisible=show?'true':'false';
    });

    const count=section.querySelector<HTMLElement>('.map-browser-state-head small');
    if(count){
     if(listedOnly){
      const next=`${stateCount.toLocaleString()} listed dispensar${stateCount===1?'y':'ies'}`;
      if(count.textContent!==next)count.textContent=next;
     }
    }
   });

   const summary=panel?.querySelector<HTMLElement>('.map-browser-panel-head strong');
   if(summary&&listedOnly){
    const next=regionFiltered
     ?`${listedInScope.length.toLocaleString()} listed location${listedInScope.length===1?'':'s'} · ${selectedRegion}`
     :`${listedInScope.length.toLocaleString()} listed locations · ${countries.size.toLocaleString()} countr${countries.size===1?'y':'ies'}`;
    if(summary.textContent!==next)summary.textContent=next;
   }

   const existingEmpty=panel?.querySelector<HTMLElement>('.enabled-filter-empty');
   if(listedOnly&&panel&&listedInScope.length===0){
    if(!existingEmpty){
     const list=panel.querySelector<HTMLElement>('.map-browser-list');
     if(list){const node=document.createElement('div');node.className='map-browser-empty enabled-filter-empty';node.textContent='No listed gameplay dispensaries match the active filters.';list.appendChild(node);}
    }
   }else existingEmpty?.remove();

   window.dispatchEvent(new CustomEvent('geoweedo:listed-filter-applied',{detail:{scope,visibleRows:listedOnly?listedInScope.length:undefined,visibleStates:listedOnly?regionCounts.size:undefined,countries:listedOnly?countries.size:undefined}}));
  };

  document.documentElement.dataset.geoweedoBrowseScope='all';
  fetch('/api/dispensaries',{cache:'no-store'})
   .then(response=>response.ok?response.json():Promise.reject())
   .then(data=>{if(cancelled)return;listed=Array.isArray(data?.dispensaries)?data.dispensaries:[];apply();})
   .catch(()=>{listed=[];apply();});

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
