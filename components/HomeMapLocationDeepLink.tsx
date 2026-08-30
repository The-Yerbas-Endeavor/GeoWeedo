'use client';

import { useEffect } from 'react';

export default function HomeMapLocationDeepLink(){
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search),locationId=params.get('location');
  if(!locationId)return;
  let disposed=false;
  async function focus(){
   try{
    const response=await fetch(`/api/dispensaries/${encodeURIComponent(locationId)}`,{cache:'no-store'});
    if(!response.ok)return;
    const data=await response.json();const name=String(data?.location?.name||'').trim();if(!name||disposed)return;
    const attempt=()=>{
     if(disposed)return false;
     const input=document.querySelector<HTMLInputElement>('.map-browser-tools input[aria-label="Search dispensaries"]');
     if(input&&input.value!==name){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(input,name);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
     const rows=Array.from(document.querySelectorAll<HTMLButtonElement>('.map-browser-row'));
     const row=rows.find(button=>(button.querySelector('strong')?.textContent||'').trim().toLowerCase()===name.toLowerCase());
     if(row){row.click();window.history.replaceState({},'',window.location.pathname);return true;}
     return false;
    };
    if(attempt())return;
    const observer=new MutationObserver(()=>{if(attempt())observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});
    const timers=[300,700,1200,2000,3200].map(delay=>window.setTimeout(()=>{if(attempt())observer.disconnect();},delay));
    window.setTimeout(()=>{observer.disconnect();timers.forEach(window.clearTimeout);},5000);
   }catch{}
  }
  void focus();return()=>{disposed=true;};
 },[]);
 return null;
}
