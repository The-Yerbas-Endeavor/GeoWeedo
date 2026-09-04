'use client';

import { useEffect } from 'react';

type MapDispensary={
  id:string;slug?:string;name:string;latitude:number;longitude:number;city?:string;region?:string;country?:string;
  status?:string;imageryStatus?:string;imageryVerifiedAt?:string;panoramaId?:string;imageryPhotoId?:string;imageryUrl?:string;
};
type BrowseScope='all'|'listed'|'playable';

const normalize=(value:unknown)=>String(value||'').trim().toLowerCase();
const labelKey=(name:unknown,city:unknown,region:unknown)=>`${normalize(name)}|${normalize(city)}|${normalize(region)}`;
const mappedKey=(item:MapDispensary)=>`${normalize(item.name)}|${Number(item.latitude).toFixed(5)}|${Number(item.longitude).toFixed(5)}`;
const valid=(item:MapDispensary)=>Number.isFinite(Number(item.latitude))&&Number.isFinite(Number(item.longitude));
const dedupe=(items:MapDispensary[])=>{const seen=new Set<string>();return items.filter(item=>{if(!valid(item))return false;const key=mappedKey(item);if(seen.has(key))return false;seen.add(key);return true;});};
const playableCandidate=(item:MapDispensary)=>normalize(item.status)==='approved'&&normalize(item.imageryStatus)==='coverage';
const playableListing=(item:MapDispensary)=>Boolean(item.imageryVerifiedAt||item.panoramaId||item.imageryPhotoId||item.imageryUrl);

export default function EnabledDispensaryBrowseFilter(){
 useEffect(()=>{
  let cancelled=false;
  let scope:BrowseScope='all';
  let listed:MapDispensary[]=[];
  let playable:MapDispensary[]=[];
  let mapped:MapDispensary[]=[];
  let timer:number|undefined;
  let idleHandle:number|undefined;
  let dataPromise:Promise<void>|null=null;
  let dataReady=false;
  const mappedCounts=new Map<string,number>(),listedCounts=new Map<string,number>(),playableCounts=new Map<string,number>();

  const countByRegion=(items:MapDispensary[],target:Map<string,number>)=>{target.clear();for(const item of items){const key=String(item.region||'').trim();if(key)target.set(key,(target.get(key)||0)+1);}};
  const scopedItems=()=>scope==='listed'?listed:scope==='playable'?playable:mapped;
  const byRegion=(items:MapDispensary[],region:string)=>region&&region!=='all'?items.filter(item=>String(item.region||'').trim()===region):items;

  const scheduleApply=(delay=80)=>{window.clearTimeout(timer);timer=window.setTimeout(apply,delay);};
  const publishScope=()=>{document.documentElement.dataset.geoweedoBrowseScope=scope;window.dispatchEvent(new CustomEvent('geoweedo:browse-scope-change',{detail:{scope}}));};

  const loadScopeData=()=>{
   if(dataPromise)return dataPromise;
   dataPromise=Promise.all([
    fetch('/api/dispensaries',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()),
    fetch('/api/map-candidates',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()),
   ]).then(([dispensaryData,candidateData])=>{
    if(cancelled)return;
    const publicListings:MapDispensary[]=Array.isArray(dispensaryData?.dispensaries)?dispensaryData.dispensaries:[];
    const candidates:MapDispensary[]=Array.isArray(candidateData?.candidates)?candidateData.candidates:[];

    // Public terminology:
    // mapped   = any non-rejected location with valid coordinates
    // listed   = active + verified public dispensaries from /api/dispensaries
    // playable = approved locations with verified/available street imagery
    listed=dedupe(publicListings);
    playable=dedupe([...publicListings.filter(playableListing),...candidates.filter(playableCandidate)]);
    mapped=dedupe([...publicListings,...candidates]);

    countByRegion(mapped,mappedCounts);countByRegion(listed,listedCounts);countByRegion(playable,playableCounts);
    dataReady=true;scheduleApply(0);
   }).catch(()=>{listed=[];playable=[];mapped=[];dataReady=true;scheduleApply(0);});
   return dataPromise;
  };

  const ensureScopeSelect=()=>{
   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');if(!tools)return null;
   tools.querySelector('.map-enabled-filter-button')?.remove();
   let select=tools.querySelector<HTMLSelectElement>('.map-scope-filter-select');
   const expected='all|listed|playable';
   if(select&&Array.from(select.options).map(o=>o.value).join('|')!==expected){select.remove();select=null;}
   if(!select){
    select=document.createElement('select');select.className='map-scope-filter-select';select.setAttribute('aria-label','Dispensary map scope');select.title='Choose which dispensary locations to show';
    for(const [value,label] of [['all','All'],['listed','Listed'],['playable','Playable']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);}
    select.addEventListener('change',()=>{scope=select!.value==='listed'?'listed':select!.value==='playable'?'playable':'all';publishScope();if(scope!=='all'&&!dataReady)void loadScopeData();scheduleApply(0);});
    const listButton=Array.from(tools.querySelectorAll<HTMLButtonElement>('button')).find(item=>/^(hide list|list \()/i.test((item.textContent||'').trim()));
    if(listButton)tools.insertBefore(select,listButton);else tools.appendChild(select);
   }
   if(select.value!==scope)select.value=scope;return select;
  };

  const restoreMarkers=()=>document.querySelectorAll<HTMLElement>('.maplibregl-marker[data-enabled-filter-original-display]').forEach(marker=>{const original=marker.dataset.enabledFilterOriginalDisplay;if(original==='__empty__')marker.style.removeProperty('display');else if(original!==undefined)marker.style.display=original;});

  const applyMarkerScope=(items:MapDispensary[])=>{
   if(scope==='all'){restoreMarkers();return;}
   const ids=new Set(items.map(item=>String(item.id)));
   const labels=new Set(items.map(item=>labelKey(item.name,item.city,item.region)));
   document.querySelectorAll<HTMLElement>('.maplibregl-marker[data-location-identity]').forEach(marker=>{
    if(!marker.dataset.enabledFilterOriginalDisplay)marker.dataset.enabledFilterOriginalDisplay=marker.style.display||'__empty__';
    const markerId=(marker.dataset.locationIdentity||'').split('|')[0];
    const parts=(marker.title||'').split(' · ');
    const markerLabel=labelKey(parts[0],parts[1],parts[2]);
    const show=ids.has(markerId)||labels.has(markerLabel);
    if(show){const original=marker.dataset.enabledFilterOriginalDisplay;if(original==='__empty__')marker.style.removeProperty('display');else if(original!==undefined)marker.style.display=original;}
    else marker.style.setProperty('display','none','important');
   });
  };

  const makeScopedList=(section:HTMLElement,state:string,items:MapDispensary[])=>{
   section.querySelector('.geoweedo-scope-generated')?.remove();
   const head=section.querySelector<HTMLElement>('.map-browser-state-head');
   const isOpen=head?.getAttribute('aria-expanded')==='true';
   const original=section.querySelector<HTMLElement>('.map-browser-state-list');
   if(scope==='all'){if(original)original.style.display='';return;}
   if(original)original.style.display='none';
   if(!isOpen||!items.length)return;
   const wrap=document.createElement('div');wrap.className='map-browser-state-list geoweedo-scope-generated';
   for(const item of items.sort((a,b)=>(a.city||'').localeCompare(b.city||'')||a.name.localeCompare(b.name))){
    const row=document.createElement('a');row.className='map-browser-row geoweedo-scope-row';row.href=`/?location=${encodeURIComponent(item.slug||item.id)}`;row.style.textDecoration='none';
    const pin=document.createElement('span');pin.className='map-browser-row-pin';pin.textContent='●';
    const copy=document.createElement('span');copy.className='map-browser-row-copy';const strong=document.createElement('strong');strong.textContent=item.name;const small=document.createElement('small');small.textContent=item.city||state;copy.append(strong,small);
    const status=document.createElement('span');status.className='map-browser-row-status';status.textContent=scope==='playable'?'PLAY':'LISTED';
    row.append(pin,copy,status);wrap.appendChild(row);
   }
   section.appendChild(wrap);
  };

  function apply(){
   if(cancelled||!document.querySelector('.map-first-home'))return;
   document.querySelectorAll('.map-browser-scope-tabs').forEach(node=>node.remove());
   const control=ensureScopeSelect();if(control&&control.value!==scope)control.value=scope;
   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');
   const regionSelect=tools?.querySelector<HTMLSelectElement>('select[aria-label="Filter by state"]');
   const selectedRegion=String(regionSelect?.value||'all').trim();const regionFiltered=Boolean(selectedRegion&&selectedRegion!=='all');
   const panel=document.querySelector<HTMLElement>('.map-browser-panel');

   if(scope!=='all'&&!dataReady){void loadScopeData();const summary=panel?.querySelector<HTMLElement>('.map-browser-panel-head strong');if(summary)summary.textContent='Loading dispensary classification…';return;}
   if(!dataReady)return;

   const active=byRegion(scopedItems(),selectedRegion);const mappedInScope=byRegion(mapped,selectedRegion),listedInScope=byRegion(listed,selectedRegion),playableInScope=byRegion(playable,selectedRegion);
   applyMarkerScope(scopedItems());

   document.querySelectorAll<HTMLElement>('.map-browser-state').forEach(section=>{
    const state=section.querySelector<HTMLElement>('.map-browser-state-head strong')?.textContent?.trim()||'';
    const countNode=section.querySelector<HTMLElement>('.map-browser-state-head small');
    const mappedCount=mappedCounts.get(state)||0,listedCount=listedCounts.get(state)||0,playableCount=playableCounts.get(state)||0;
    const regionMatches=!regionFiltered||state===selectedRegion;const scopeCount=scope==='listed'?listedCount:scope==='playable'?playableCount:mappedCount;
    section.style.display=(!regionMatches||(scope!=='all'&&scopeCount===0))?'none':'';
    if(countNode)countNode.textContent=`${mappedCount.toLocaleString()} mapped · ${listedCount.toLocaleString()} listed · ${playableCount.toLocaleString()} playable`;
    const stateItems=active.filter(item=>String(item.region||'').trim()===state);makeScopedList(section,state,stateItems);
   });

   const countries=new Set(active.map(item=>String(item.country||'USA').trim()||'USA'));
   const summary=panel?.querySelector<HTMLElement>('.map-browser-panel-head strong');
   if(summary){
    if(regionFiltered)summary.textContent=`${mappedInScope.length.toLocaleString()} mapped · ${listedInScope.length.toLocaleString()} listed · ${playableInScope.length.toLocaleString()} playable · ${selectedRegion}`;
    else if(scope==='listed')summary.textContent=`${listedInScope.length.toLocaleString()} listed locations · ${countries.size.toLocaleString()} countr${countries.size===1?'y':'ies'}`;
    else if(scope==='playable')summary.textContent=`${playableInScope.length.toLocaleString()} playable locations · ${countries.size.toLocaleString()} countr${countries.size===1?'y':'ies'}`;
   }

   const existingEmpty=panel?.querySelector<HTMLElement>('.enabled-filter-empty');
   if(scope!=='all'&&active.length===0){if(!existingEmpty){const list=panel?.querySelector<HTMLElement>('.map-browser-list');if(list){const node=document.createElement('div');node.className='map-browser-empty enabled-filter-empty';node.textContent=scope==='listed'?'No listed dispensaries match the active filters.':'No playable dispensaries match the active filters.';list.appendChild(node);}}}else existingEmpty?.remove();
   window.dispatchEvent(new CustomEvent('geoweedo:listed-filter-applied',{detail:{scope,region:selectedRegion,visibleRows:active.length,countries:countries.size}}));
  }

  const onFilterChange=(event:Event)=>{const target=event.target as HTMLSelectElement|null;if(target?.matches('select[aria-label="Filter by state"]'))scheduleApply(0);};
  document.documentElement.dataset.geoweedoBrowseScope='all';apply();
  const idle=()=>{if(!cancelled)void loadScopeData();};
  if(typeof (window as any).requestIdleCallback==='function')idleHandle=(window as any).requestIdleCallback(idle,{timeout:1800});else idleHandle=window.setTimeout(idle,1100);

  const observer=new MutationObserver(mutations=>{const relevant=mutations.some(m=>Array.from(m.addedNodes).some(node=>node instanceof HTMLElement&&(node.matches?.('.map-browser-tools,.map-browser-panel,.map-browser-state,.map-browser-state-list')||node.querySelector?.('.map-browser-tools,.map-browser-panel,.map-browser-state,.map-browser-state-list'))));if(relevant)scheduleApply(100);});
  observer.observe(document.body,{subtree:true,childList:true});document.addEventListener('change',onFilterChange,true);

  return()=>{cancelled=true;window.clearTimeout(timer);observer.disconnect();document.removeEventListener('change',onFilterChange,true);restoreMarkers();delete document.documentElement.dataset.geoweedoBrowseScope;if(idleHandle!==undefined){if(typeof (window as any).cancelIdleCallback==='function')(window as any).cancelIdleCallback(idleHandle);else window.clearTimeout(idleHandle);}};
 },[]);
 return null;
}
