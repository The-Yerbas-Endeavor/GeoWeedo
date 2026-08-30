'use client';

import { useEffect } from 'react';

export default function HomeMapLocationDeepLink(){
 useEffect(()=>{
  const profileMatch=window.location.pathname.match(/^\/dispensary\/([^/]+)/);
  if(profileMatch){
   const locationId=decodeURIComponent(profileMatch[1] ?? '');
   if(!locationId)return;
   const rewrite=()=>{
    const addressCard=Array.from(document.querySelectorAll<HTMLElement>('.profile-info-card')).find(card=>(card.querySelector(':scope > span')?.textContent||'').trim()==='ADDRESS');
    const link=addressCard?.querySelector<HTMLAnchorElement>('a');
    if(!link)return false;
    link.href=`/?location=${encodeURIComponent(locationId)}`;
    link.removeAttribute('target');
    link.removeAttribute('rel');
    link.title='Show this dispensary on the GeoWeedo map';
    return true;
   };
   if(!rewrite()){
    const observer=new MutationObserver(()=>{if(rewrite())observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
    const timer=window.setTimeout(()=>observer.disconnect(),5000);
    return()=>{observer.disconnect();window.clearTimeout(timer);};
   }
   return;
  }

  const params=new URLSearchParams(window.location.search),locationParam=params.get('location');
  if(!locationParam)return;
  const locationId=locationParam;
  let disposed=false;
  async function focus(){
   try{
    const response=await fetch(`/api/dispensaries/${encodeURIComponent(locationId)}`,{cache:'no-store'});
    if(!response.ok)return;
    const data=await response.json();
    const name=String(data?.location?.name||'').trim();
    if(!name||disposed)return;
    const attempt=()=>{
     if(disposed)return false;
     const input=document.querySelector<HTMLInputElement>('.map-browser-tools input[aria-label="Search dispensaries"]');
     if(input&&input.value!==name){
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      setter?.call(input,name);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
     }
     const rows=Array.from(document.querySelectorAll<HTMLButtonElement>('.map-browser-row'));
     const row=rows.find(button=>(button.querySelector('strong')?.textContent||'').trim().toLowerCase()===name.toLowerCase());
     if(row){
      row.click();
      window.history.replaceState({},'',window.location.pathname);
      return true;
     }
     return false;
    };
    if(attempt())return;
    const observer=new MutationObserver(()=>{if(attempt())observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
    const timers=[300,700,1200,2000,3200].map(delay=>window.setTimeout(()=>{if(attempt())observer.disconnect();},delay));
    window.setTimeout(()=>{observer.disconnect();timers.forEach(window.clearTimeout);},5000);
   }catch{}
  }
  void focus();
  return()=>{disposed=true;};
 },[]);
 return null;
}
