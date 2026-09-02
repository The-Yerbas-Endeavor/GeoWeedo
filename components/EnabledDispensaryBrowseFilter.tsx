'use client';

import { useEffect } from 'react';

type ListedDispensary={id:string;name:string;latitude:number;longitude:number;city?:string;region?:string;country?:string};
type BrowseScope='all'|'listed';

const normalize=(value:string|undefined)=>String(value||'').trim().toLowerCase();
const identity=(item:ListedDispensary)=>`${item.id}|${Number(item.latitude).toFixed(6)}|${Number(item.longitude).toFixed(6)}`;
const labelKey=(name:string|undefined,city:string|undefined,region:string|undefined)=>`${normalize(name)}|${normalize(city)}|${normalize(region)}`;
const numberFromText=(value:string|undefined)=>Number(String(value||'').replace(/[^0-9]/g,''))||0;

export default function EnabledDispensaryBrowseFilter(){
 useEffect(()=>{
  let cancelled=false;
  let scope:BrowseScope='all';
  let listed:ListedDispensary[]=[];
  let timer:number|undefined;
  const mappedCounts=new Map<string,number>();

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
   if(select){if(select.value!==scope)select.value=scope;return select;}
   select=document.createElement('select');
   select.className='map-scope-filter-select';
   select.setAttribute('aria-label','Dispensary map scope');
   select.title='Choose which dispensary locations to show';
   for(const [value,label] of [['all','All'],['listed','Listed']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);}
   select.value=scope;
   select.addEventListener('change',()=>{scope=select!.value==='listed'?'listed':'all';publishScope();apply();});
   const listButton=Array.from(tools.querySelectorAll<HTMLButtonElement>('button')).find(item=>/^(hide list|list \()/i.test((item.textContent||'').trim()));
   if(listButton)tools.insertBefore(select,listButton);else tools.appendChild(select);
   return select;
  };

  const removePanelTabs=()=>document.querySelectorAll('.map-browser-scope-tabs').forEach(node=>node.remove());

  const apply=()=>{
   if(cancelled||!document.querySelector('.map-first-home'))return;
   removePanelTabs();syncListToggle();const control=ensureScopeSelect();if(control&&control.value!==scope)control.value=scope;
   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');
   const regionSelect=tools?.querySelector<HTMLSelectElement>('select[aria-label="Filter by state"]');
   const selectedRegion=String(regionSelect?.value||'all').trim();
   const regionFiltered=selectedRegion&&selectedRegion!=='all';
   const listedInScope=regionFiltered?listed.filter(item=>String(item.region||'').trim()===selectedRegion):listed;
   const listedOnly=scope==='listed';
   const panel=document.querySelector<HTMLElement>('.map-browser-panel');
   const listedIds=new Set(listed.map(identity));
   const listedLabels=new Set(listed.map(item=>labelKey(item.name,item.city,item.region)));
   const regionCounts=new Map<string,number>();const countries=new Set<string>();
   for(const item of listedInScope){const itemRegion=String(item.region||'').trim();if(itemRegion)regionCounts.set(itemRegion,(regionCounts.get(itemRegion)||0)+1);countries.add(String(item.country||'USA').trim()||'USA');}

   document.querySelectorAll<HTMLElement>('.maplibregl-marker[data-location-identity]').forEach(marker=>{if(!marker.dataset.enabledFilterOriginalDisplay)marker.dataset.enabledFilterOriginalDisplay=marker.style.display||'__empty__';if(listedOnly)marker.style.setProperty('display',listedIds.has(marker.dataset.locationIdentity||'')?'':'none','important');else{const original=marker.dataset.enabledFilterOriginalDisplay;if(original==='__empty__')marker.style.removeProperty('display');else if(original!==undefined)marker.style.display=original;}});

   let selectedRegionRows=0;
   document.querySelectorAll<HTMLElement>('.map-browser-state').forEach(section=>{
    const state=section.querySelector<HTMLElement>('.map-browser-state-head strong')?.textContent?.trim()||'';
    const countNode=section.querySelector<HTMLElement>('.map-browser-state-head small');
    if(state&&!mappedCounts.has(state)&&countNode){const initial=numberFromText(countNode.textContent||'');if(initial>0)mappedCounts.set(state,initial);}
    const mappedCount=mappedCounts.get(state)||0;
    const stateCount=listed.filter(item=>String(item.region||'').trim()===state).length;
    const regionMatches=!regionFiltered||state===selectedRegion;
    section.dataset.listedCount=String(stateCount);section.dataset.mappedCount=String(mappedCount);
    section.style.display=(!regionMatches||(listedOnly&&stateCount===0))?'none':'';
    let sectionVisibleRows=0;
    section.querySelectorAll<HTMLElement>('.map-browser-row').forEach(row=>{const name=row.querySelector<HTMLElement>('.map-browser-row-copy strong')?.textContent?.trim()||'';const city=row.querySelector<HTMLElement>('.map-browser-row-copy small')?.textContent?.trim()||'';const listedMatch=listedLabels.has(labelKey(name,city,state));const show=regionMatches&&(!listedOnly||listedMatch);row.style.display=show?'':'none';row.dataset.listedVisible=show?'true':'false';if(show)sectionVisibleRows++;});
    if(regionMatches)selectedRegionRows+=sectionVisibleRows;
    if(countNode){
     const next=`${mappedCount.toLocaleString()} mapped · ${stateCount.toLocaleString()} listed`;
     if(countNode.textContent!==next)countNode.textContent=next;
    }
   });

   const summary=panel?.querySelector<HTMLElement>('.map-browser-panel-head strong');
   if(summary){let next:string|undefined;if(regionFiltered){const mapped=mappedCounts.get(selectedRegion)||selectedRegionRows;const listedCount=listedInScope.length;next=`${mapped.toLocaleString()} mapped · ${listedCount.toLocaleString()} listed · ${selectedRegion}`;}else if(listedOnly){next=`${listedInScope.length.toLocaleString()} listed locations · ${countries.size.toLocaleString()} countr${countries.size===1?'y':'ies'}`;}if(next&&summary.textContent!==next)summary.textContent=next;}

   const existingEmpty=panel?.querySelector<HTMLElement>('.enabled-filter-empty');const activeCount=listedOnly?listedInScope.length:regionFiltered?selectedRegionRows:undefined;
   if(panel&&activeCount===0){if(!existingEmpty){const list=panel.querySelector<HTMLElement>('.map-browser-list');if(list){const node=document.createElement('div');node.className='map-browser-empty enabled-filter-empty';node.textContent=listedOnly?'No listed gameplay dispensaries match the active filters.':'No dispensaries match the selected state.';list.appendChild(node);}}}else existingEmpty?.remove();
   window.dispatchEvent(new CustomEvent('geoweedo:listed-filter-applied',{detail:{scope,region:selectedRegion,visibleRows:activeCount,visibleStates:regionFiltered?(activeCount?1:0):listedOnly?regionCounts.size:undefined,countries:listedOnly?countries.size:undefined}}));
  };

  const onFilterChange=(event:Event)=>{const target=event.target as HTMLSelectElement|null;if(target?.matches('select[aria-label="Filter by state"]'))window.setTimeout(apply,0);};
  document.documentElement.dataset.geoweedoBrowseScope='all';
  fetch('/api/dispensaries',{cache:'no-store'}).then(response=>response.ok?response.json():Promise.reject()).then(data=>{if(cancelled)return;listed=Array.isArray(data?.dispensaries)?data.dispensaries:[];apply();}).catch(()=>{listed=[];apply();});
  const observer=new MutationObserver(()=>{window.clearTimeout(timer);timer=window.setTimeout(apply,30);});observer.observe(document.body,{subtree:true,childList:true});document.addEventListener('change',onFilterChange,true);window.addEventListener('resize',apply);apply();
  return()=>{cancelled=true;window.clearTimeout(timer);observer.disconnect();document.removeEventListener('change',onFilterChange,true);window.removeEventListener('resize',apply);delete document.documentElement.dataset.geoweedoBrowseScope;};
 },[]);
 return null;
}
