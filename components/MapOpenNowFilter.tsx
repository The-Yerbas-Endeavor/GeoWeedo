'use client';

import {useEffect} from 'react';

type OpenNowEventDetail={enabled:boolean;openIds:string[]};

export default function MapOpenNowFilter(){
 useEffect(()=>{
  let disposed=false,enabled=false,loading=false,openIds:string[]=[],frame=0,selectedRegionCount:number|null=null;

  const broadcast=()=>window.dispatchEvent(new CustomEvent<OpenNowEventDetail>('geoweedo:open-now',{detail:{enabled,openIds}}));
  const updateButton=()=>{
   const button=document.querySelector<HTMLButtonElement>('[data-geoweedo-open-now]');
   if(!button)return;
   const activeCount=selectedRegionCount==null?openIds.length:selectedRegionCount;
   const nextText=loading?'Open now…':enabled?`✓ Open now (${activeCount})`:'Open now';
   if(button.textContent!==nextText)button.textContent=nextText;
   button.setAttribute('aria-pressed',String(enabled));
   button.disabled=loading;
  };

  const ensureSearchPlacement=()=>{
   const tools=document.querySelector<HTMLElement>('.map-browser-tools');
   if(!tools)return;
   const openNow=tools.querySelector<HTMLElement>('[data-geoweedo-open-now]');
   const nearMe=tools.querySelector<HTMLElement>('[data-geoweedo-near-me]');
   const search=tools.querySelector<HTMLElement>('.map-unified-search');
   if(!search)return;

   // Keep the primary location controls together:
   // Search → Near me → Open now → state/display filters.
   if(tools.firstElementChild!==search)tools.prepend(search);
   if(nearMe&&search.nextElementSibling!==nearMe)search.insertAdjacentElement('afterend',nearMe);
   const anchor=nearMe||search;
   if(openNow&&anchor.nextElementSibling!==openNow)anchor.insertAdjacentElement('afterend',openNow);
  };

  const ensureButton=()=>{
   const tools=document.querySelector<HTMLElement>('.map-browser-tools');
   if(!tools)return;
   let button=tools.querySelector<HTMLButtonElement>('[data-geoweedo-open-now]');
   if(!button){
    button=document.createElement('button');
    button.type='button';
    button.dataset.geoweedoOpenNow='1';
    button.textContent='Open now';
    button.setAttribute('aria-pressed','false');
    button.addEventListener('click',async()=>{
     if(enabled){enabled=false;openIds=[];updateButton();broadcast();return;}
     loading=true;updateButton();
     try{
      const response=await fetch('/api/dispensaries/open-now',{cache:'no-store'}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'Could not check hours.');
      openIds=Array.isArray(data.openIds)?data.openIds.map((value:unknown)=>String(value)):[];
      enabled=true;
     }catch{
      enabled=false;openIds=[];
     }finally{
      loading=false;updateButton();broadcast();
     }
    });
   }
   if(tools.firstElementChild!==button)tools.prepend(button);
   ensureSearchPlacement();
   updateButton();
  };

  const onRegionCounts=(event:Event)=>{
   const detail=(event as CustomEvent<{region?:string;enabledCount?:number;nearbyActive?:boolean;radiusMiles?:number|null}>).detail;
   // This count is already scoped by the active map filters (state/search/ZIP/Near me).
   // When Open now is enabled it therefore matches the number of open locations
   // actually being shown, rather than the global open count.
   selectedRegionCount=Number.isFinite(Number(detail?.enabledCount))?Number(detail.enabledCount):null;
   updateButton();
  };
  window.addEventListener('geoweedo:map-region-counts',onRegionCounts as EventListener);

  const schedule=()=>{
   if(disposed||frame)return;
   frame=window.requestAnimationFrame(()=>{frame=0;ensureButton();});
  };
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{childList:true,subtree:true});
  schedule();
  return()=>{
   disposed=true;observer.disconnect();window.removeEventListener('geoweedo:map-region-counts',onRegionCounts as EventListener);if(frame)window.cancelAnimationFrame(frame);
   enabled=false;openIds=[];broadcast();
   document.querySelector('[data-geoweedo-open-now]')?.remove();
  };
 },[]);
 return null;
}
