'use client';

import { useEffect } from 'react';

type MapDispensary={id:string;name:string;latitude:number;longitude:number;city?:string;region?:string;country?:string;status?:string};
type BrowseScope='all'|'listed'|'enabled';

const normalize=(value:string|undefined)=>String(value||'').trim().toLowerCase();
const identity=(item:MapDispensary)=>`${item.id}|${Number(item.latitude).toFixed(6)}|${Number(item.longitude).toFixed(6)}`;
const labelKey=(name:string|undefined,city:string|undefined,region:string|undefined)=>`${normalize(name)}|${normalize(city)}|${normalize(region)}`;
const mappedKey=(item:MapDispensary)=>`${normalize(item.name)}|${Number(item.latitude).toFixed(5)}|${Number(item.longitude).toFixed(5)}`;

export default function EnabledDispensaryBrowseFilter(){
 useEffect(()=>{
  let cancelled=false;
  let scope:BrowseScope='all';
  let enabled:MapDispensary[]=[];
  let listed:MapDispensary[]=[];
  let mapped:MapDispensary[]=[];
  let timer:number|undefined;
  let idleHandle:number|undefined;
  let dataPromise:Promise<void>|null=null;
  let dataReady=false;
  const mappedCounts=new Map<string,number>(),listedCounts=new Map<string,number>(),enabledCounts=new Map<string,number>();

  const publishScope=()=>{
   document.documentElement.dataset.geoweedoBrowseScope=scope;
   window.dispatchEvent(new CustomEvent('geoweedo:browse-scope-change',{detail:{scope}}));
  };

  const scheduleApply=(delay=140)=>{
   window.clearTimeout(timer);
   timer=window.setTimeout(apply,delay);
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

  const loadScopeData=()=>{
   if(dataPromise)return dataPromise;
   dataPromise=Promise.all([
    fetch('/api/dispensaries',{cache:'no-store'}).then(response=>response.ok?response.json():Promise.reject()),
    fetch('/api/map-candidates',{cache:'no-store'}).then(response=>response.ok?response.json():Promise.reject()),
   ]).then(([dispensaryData,candidateData])=>{
    if(cancelled)return;
    enabled=Array.isArray(dispensaryData?.dispensaries)?dispensaryData.dispensaries:[];
    const candidates:MapDispensary[]=Array.isArray(candidateData?.candidates)?candidateData.candidates:[];
    const approvedCandidates=candidates.filter(item=>String(item.status||'').toLowerCase()==='approved');
    const listedCombined=[...enabled,...approvedCandidates];const listedSeen=new Set<string>();
    listed=listedCombined.filter(item=>{if(!Number.isFinite(Number(item.latitude))||!Number.isFinite(Number(item.longitude)))return false;const key=mappedKey(item);if(listedSeen.has(key))return false;listedSeen.add(key);return true;});
    const combined=[...enabled,...candidates];const seen=new Set<string>();
    mapped=combined.filter(item=>{if(!Number.isFinite(Number(item.latitude))||!Number.isFinite(Number(item.longitude)))return false;const key=mappedKey(item);if(seen.has(key))return false;seen.add(key);return true;});
    mappedCounts.clear();listedCounts.clear();enabledCounts.clear();
    for(const item of mapped){const key=String(item.region||'').trim();if(key)mappedCounts.set(key,(mappedCounts.get(key)||0)+1);}
    for(const item of listed){const key=String(item.region||'').trim();if(key)listedCounts.set(key,(listedCounts.get(key)||0)+1);}
    for(const item of enabled){const key=String(item.region||'').trim();if(key)enabledCounts.set(key,(enabledCounts.get(key)||0)+1);}
    dataReady=true;
    scheduleApply(0);
   }).catch(()=>{enabled=[];listed=[];mapped=[];dataReady=true;scheduleApply(0);});
   return dataPromise;
  };

  const ensureScopeSelect=()=>{
   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');
   if(!tools)return null;
   tools.querySelector('.map-enabled-filter-button')?.remove();
   let select=tools.querySelector<HTMLSelectElement>('.map-scope-filter-select');
   if(select){
    const values=Array.from(select.options).map(option=>option.value).join('|');
    if(values!=='all|listed|enabled')select.remove();
    else{if(select.value!==scope)select.value=scope;return select;}
   }
   select=document.createElement('select');
   select.className='map-scope-filter-select';
   select.setAttribute('aria-label','Dispensary map scope');
   select.title='Choose which dispensary locations to show';
   for(const [value,label] of [['all','All'],['listed','Listed'],['enabled','Enabled']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);}
   select.value=scope;
   select.addEventListener('change',()=>{const value=select!.value;scope=value==='enabled'?'enabled':value==='listed'?'listed':'all';publishScope();if(scope!=='all'&&!dataReady)void loadScopeData();scheduleApply(0);});
   const listButton=Array.from(tools.querySelectorAll<HTMLButtonElement>('button')).find(item=>/^(hide list|list \()/i.test((item.textContent||'').trim()));
   if(listButton)tools.insertBefore(select,listButton);else tools.appendChild(select);
   return select;
  };

  const removePanelTabs=()=>document.querySelectorAll('.map-browser-scope-tabs').forEach(node=>node.remove());

  function apply(){
   if(cancelled||!document.querySelector('.map-first-home'))return;
   removePanelTabs();syncListToggle();const control=ensureScopeSelect();if(control&&control.value!==scope)control.value=scope;
   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');
   const regionSelect=tools?.querySelector<HTMLSelectElement>('select[aria-label="Filter by state"]');
   const selectedRegion=String(regionSelect?.value||'all').trim();
   const regionFiltered=Boolean(selectedRegion&&selectedRegion!=='all');
   const listedOnly=scope==='listed';
   const enabledOnly=scope==='enabled';
   const scopedMode=listedOnly||enabledOnly;
   const panel=document.querySelector<HTMLElement>('.map-browser-panel');

   if(scopedMode&&!dataReady){
    void loadScopeData();
    const summary=panel?.querySelector<HTMLElement>('.map-browser-panel-head strong');
    if(summary)summary.textContent='Loading dispensary classification…';
    return;
   }

   const listedInScope=regionFiltered?listed.filter(item=>String(item.region||'').trim()===selectedRegion):listed;
   const enabledInScope=regionFiltered?enabled.filter(item=>String(item.region||'').trim()===selectedRegion):enabled;
   const mappedInScope=regionFiltered?mapped.filter(item=>String(item.region||'').trim()===selectedRegion):mapped;
   const listedIds=scopedMode?new Set(listed.map(identity)):null;
   const enabledIds=scopedMode?new Set(enabled.map(identity)):null;
   const listedLabels=scopedMode?new Set(listed.map(item=>labelKey(item.name,item.city,item.region))):null;
   const enabledLabels=scopedMode?new Set(enabled.map(item=>labelKey(item.name,item.city,item.region))):null;
   const countries=new Set<string>();
   const scopedItems=enabledOnly?enabledInScope:listedOnly?listedInScope:mappedInScope;
   for(const item of scopedItems)countries.add(String(item.country||'USA').trim()||'USA');

   // The default All scope deliberately avoids scanning thousands of marker DOM nodes.
   if(scopedMode){
    document.querySelectorAll<HTMLElement>('.maplibregl-marker[data-location-identity]').forEach(marker=>{
     if(!marker.dataset.enabledFilterOriginalDisplay)marker.dataset.enabledFilterOriginalDisplay=marker.style.display||'__empty__';
     const markerId=marker.dataset.locationIdentity||'';
     const show=enabledOnly?enabledIds!.has(markerId):listedIds!.has(markerId);
     if(!show)marker.style.setProperty('display','none','important');
     else{const original=marker.dataset.enabledFilterOriginalDisplay;if(original==='__empty__')marker.style.removeProperty('display');else if(original!==undefined)marker.style.display=original;}
    });
   }else{
    document.querySelectorAll<HTMLElement>('.maplibregl-marker[data-location-identity][data-enabled-filter-original-display]').forEach(marker=>{
     const original=marker.dataset.enabledFilterOriginalDisplay;if(original==='__empty__')marker.style.removeProperty('display');else if(original!==undefined)marker.style.display=original;
    });
   }

   document.querySelectorAll<HTMLElement>('.map-browser-state').forEach(section=>{
    const state=section.querySelector<HTMLElement>('.map-browser-state-head strong')?.textContent?.trim()||'';
    const countNode=section.querySelector<HTMLElement>('.map-browser-state-head small');
    const mappedCount=dataReady?(mappedCounts.get(state)||0):Number(section.dataset.mappedCount||0);
    const listedCount=dataReady?(listedCounts.get(state)||0):Number(section.dataset.listedCount||0);
    const enabledCount=dataReady?(enabledCounts.get(state)||0):Number(section.dataset.enabledCount||0);
    const regionMatches=!regionFiltered||state===selectedRegion;
    const stateScopeCount=enabledOnly?enabledCount:listedOnly?listedCount:mappedCount;
    if(dataReady){section.dataset.listedCount=String(listedCount);section.dataset.enabledCount=String(enabledCount);section.dataset.mappedCount=String(mappedCount);}
    section.style.display=(!regionMatches||(scopedMode&&stateScopeCount===0))?'none':'';

    if(scopedMode){
     const rows=Array.from(section.querySelectorAll<HTMLElement>('.map-browser-row'));
     const enabledRows:HTMLElement[]=[];const listedRows:HTMLElement[]=[];const mappedOnlyRows:HTMLElement[]=[];
     for(const row of rows){
      const name=row.querySelector<HTMLElement>('.map-browser-row-copy strong')?.textContent?.trim()||'';
      const city=row.querySelector<HTMLElement>('.map-browser-row-copy small')?.textContent?.trim()||'';
      const key=labelKey(name,city,state);
      const enabledMatch=enabledLabels!.has(key);
      const listedMatch=enabledMatch||listedLabels!.has(key);
      const show=regionMatches&&(enabledOnly?enabledMatch:listedMatch);
      row.style.display=show?'':'none';
      row.dataset.listedVisible=show?'true':'false';
      row.dataset.listedStatus=enabledMatch?'enabled':listedMatch?'listed':'mapped';
      if(enabledMatch)enabledRows.push(row);else if(listedMatch)listedRows.push(row);else mappedOnlyRows.push(row);
     }
     const desiredRows=[...enabledRows,...listedRows,...mappedOnlyRows];
     const currentRows=Array.from(section.querySelectorAll<HTMLElement>('.map-browser-row'));
     if(desiredRows.some((row,index)=>currentRows[index]!==row))desiredRows.forEach(row=>section.appendChild(row));
    }else{
     section.querySelectorAll<HTMLElement>('.map-browser-row').forEach(row=>{row.style.display='';});
    }
    if(dataReady&&countNode){const next=`${mappedCount.toLocaleString()} mapped · ${listedCount.toLocaleString()} listed · ${enabledCount.toLocaleString()} enabled`;if(countNode.textContent!==next)countNode.textContent=next;}
   });

   const summary=panel?.querySelector<HTMLElement>('.map-browser-panel-head strong');
   if(summary&&dataReady){
    let next:string|undefined;
    if(regionFiltered)next=`${mappedInScope.length.toLocaleString()} mapped · ${listedInScope.length.toLocaleString()} listed · ${enabledInScope.length.toLocaleString()} enabled · ${selectedRegion}`;
    else if(enabledOnly)next=`${enabledInScope.length.toLocaleString()} enabled locations · ${countries.size.toLocaleString()} countr${countries.size===1?'y':'ies'}`;
    else if(listedOnly)next=`${listedInScope.length.toLocaleString()} listed locations · ${countries.size.toLocaleString()} countr${countries.size===1?'y':'ies'}`;
    if(next&&summary.textContent!==next)summary.textContent=next;
   }

   const existingEmpty=panel?.querySelector<HTMLElement>('.enabled-filter-empty');
   const activeCount=enabledOnly?enabledInScope.length:listedOnly?listedInScope.length:regionFiltered&&dataReady?mappedInScope.length:undefined;
   if(panel&&activeCount===0){if(!existingEmpty){const list=panel.querySelector<HTMLElement>('.map-browser-list');if(list){const node=document.createElement('div');node.className='map-browser-empty enabled-filter-empty';node.textContent=enabledOnly?'No enabled dispensaries match the active filters.':listedOnly?'No listed dispensaries match the active filters.':'No dispensaries match the selected state.';list.appendChild(node);}}}else existingEmpty?.remove();
   window.dispatchEvent(new CustomEvent('geoweedo:listed-filter-applied',{detail:{scope,region:selectedRegion,visibleRows:activeCount,countries:countries.size}}));
  }

  const onFilterChange=(event:Event)=>{const target=event.target as HTMLSelectElement|null;if(target?.matches('select[aria-label="Filter by state"]'))scheduleApply(0);};
  document.documentElement.dataset.geoweedoBrowseScope='all';

  // Install the control immediately, but keep classification API traffic out of the critical map-startup path.
  apply();
  const idle=()=>{if(!cancelled)void loadScopeData();};
  if(typeof (window as any).requestIdleCallback==='function')idleHandle=(window as any).requestIdleCallback(idle,{timeout:1800});
  else idleHandle=window.setTimeout(idle,1100);

  const observer=new MutationObserver(mutations=>{
   const relevant=mutations.some(m=>Array.from(m.addedNodes).some(node=>node instanceof HTMLElement&&(node.matches?.('.map-browser-tools,.map-browser-panel,.map-browser-state,.map-browser-row')||node.querySelector?.('.map-browser-tools,.map-browser-panel,.map-browser-state,.map-browser-row'))));
   if(relevant)scheduleApply(180);
  });
  observer.observe(document.body,{subtree:true,childList:true});
  document.addEventListener('change',onFilterChange,true);
  window.addEventListener('resize',()=>scheduleApply(180));

  return()=>{
   cancelled=true;window.clearTimeout(timer);observer.disconnect();document.removeEventListener('change',onFilterChange,true);delete document.documentElement.dataset.geoweedoBrowseScope;
   if(idleHandle!==undefined){if(typeof (window as any).cancelIdleCallback==='function')(window as any).cancelIdleCallback(idleHandle);else window.clearTimeout(idleHandle);}
  };
 },[]);
 return null;
}
