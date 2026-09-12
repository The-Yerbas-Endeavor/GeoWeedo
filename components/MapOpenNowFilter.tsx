'use client';

import {useEffect} from 'react';

type OpenNowEventDetail={enabled:boolean;openIds:string[]};

export default function MapOpenNowFilter(){
 useEffect(()=>{
  let disposed=false,enabled=false,loading=false,openIds:string[]=[],frame=0;

  const broadcast=()=>window.dispatchEvent(new CustomEvent<OpenNowEventDetail>('geoweedo:open-now',{detail:{enabled,openIds}}));
  const updateButton=()=>{
   const button=document.querySelector<HTMLButtonElement>('[data-geoweedo-open-now]');
   if(!button)return;
   const nextText=loading?'Open now…':enabled?`✓ Open now (${openIds.length})`:'Open now';
   if(button.textContent!==nextText)button.textContent=nextText;
   button.setAttribute('aria-pressed',String(enabled));
   button.disabled=loading;
  };

  const ensureSearchPlacement=()=>{
   const tools=document.querySelector<HTMLElement>('.map-browser-tools');
   if(!tools)return;
   const openNow=tools.querySelector<HTMLElement>('[data-geoweedo-open-now]');
   const search=tools.querySelector<HTMLElement>('.map-unified-search');
   if(!search)return;

   if(openNow&&openNow.nextElementSibling!==search)openNow.insertAdjacentElement('afterend',search);
   else if(!openNow){
    const firstSelect=tools.querySelector('select');
    if(firstSelect&&firstSelect.previousElementSibling!==search)tools.insertBefore(search,firstSelect);
   }

   let scanner=tools.querySelector<HTMLAnchorElement>('[data-geoweedo-map-scanner]');
   if(!scanner){
    scanner=document.createElement('a');
    scanner.dataset.geoweedoMapScanner='1';
    scanner.href='/weedo-facts';
    scanner.setAttribute('aria-label','Scan a barcode or QR code');
    scanner.title='Scan barcode or QR code';
    scanner.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="width:18px;height:18px;display:block"><path fill="currentColor" d="M3 3h6v6H3V3Zm2 2v2h2V5H5Zm10-2h6v6h-6V3Zm2 2v2h2V5h-2ZM3 15h6v6H3v-6Zm2 2v2h2v-2H5Zm7-14h2v2h-2V3Zm0 4h2v4h-2V7Zm4 4h2v2h-2v-2Zm4 0h2v4h-2v-4Zm-8 4h2v2h-2v-2Zm4 0h4v2h-2v2h-2v-4Zm-4 4h2v2h-2v-2Zm8 0h2v2h-2v-2Z"/></svg>';
    Object.assign(scanner.style,{display:'inline-flex',alignItems:'center',justifyContent:'center',width:'38px',height:'38px',flex:'0 0 38px',border:'1px solid rgba(255,255,255,.14)',borderRadius:'999px',background:'rgba(24,33,30,.92)',color:'inherit',textDecoration:'none',boxSizing:'border-box'});
   }
   if(search.nextElementSibling!==scanner)search.insertAdjacentElement('afterend',scanner);
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

  const schedule=()=>{
   if(disposed||frame)return;
   frame=window.requestAnimationFrame(()=>{frame=0;ensureButton();});
  };
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{childList:true,subtree:true});
  schedule();
  return()=>{
   disposed=true;observer.disconnect();if(frame)window.cancelAnimationFrame(frame);
   enabled=false;openIds=[];broadcast();
   document.querySelector('[data-geoweedo-open-now]')?.remove();
   document.querySelector('[data-geoweedo-map-scanner]')?.remove();
  };
 },[]);
 return null;
}
