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
  };
 },[]);
 return null;
}
