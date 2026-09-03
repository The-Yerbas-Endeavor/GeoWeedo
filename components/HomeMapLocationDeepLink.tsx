'use client';

import { useEffect } from 'react';

export default function HomeMapLocationDeepLink(){
 useEffect(()=>{
  const profileMatch=window.location.pathname.match(/^\/dispensary\/([^/]+)/);
  if(profileMatch){
   const identifier=decodeURIComponent(profileMatch[1] ?? '');
   if(!identifier)return;
   const rewrite=()=>{
    const addressCard=Array.from(document.querySelectorAll<HTMLElement>('.profile-info-card')).find(card=>(card.querySelector(':scope > span')?.textContent||'').trim()==='ADDRESS');
    const link=addressCard?.querySelector<HTMLAnchorElement>('a');
    if(!link)return false;
    link.href=`/?location=${encodeURIComponent(identifier)}`;
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

  const params=new URLSearchParams(window.location.search),rawLocationParam=params.get('location');
  if(!rawLocationParam)return;
  const locationParam:string=rawLocationParam;
  let disposed=false;

  const minimizeIntro=()=>{
   const close=document.querySelector<HTMLButtonElement>('.home-play-card button[aria-label="Close game intro"]');
   if(close)close.click();
  };

  async function focus(){
   try{
    minimizeIntro();
    let locationId:string=locationParam;
    const resolveResponse=await fetch(`/api/dispensary-resolve/${encodeURIComponent(locationParam)}`,{cache:'no-store'});
    if(resolveResponse.ok){
     const resolved=await resolveResponse.json();
     locationId=String(resolved?.locationId||locationParam);
    }
    if(disposed)return;

    const clickExactPin=()=>{
     if(disposed)return false;
     const marker=Array.from(document.querySelectorAll<HTMLElement>('.maplibregl-marker[data-location-identity]')).find(node=>(node.dataset.locationIdentity||'').startsWith(`${locationId}|`));
     if(!marker)return false;
     marker.click();
     window.setTimeout(()=>{
      if(disposed)return;
      const zoom=document.querySelector<HTMLButtonElement>(`.map-location-card[data-location-id="${CSS.escape(locationId)}"] .map-location-focus`);
      zoom?.click();
      window.history.replaceState({},'',window.location.pathname);
     },30);
     return true;
    };

    if(clickExactPin())return;
    const observer=new MutationObserver(()=>{if(clickExactPin())observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
    const timers=[80,160,300,500,800,1200,1800].map(delay=>window.setTimeout(()=>{if(clickExactPin())observer.disconnect();},delay));
    window.setTimeout(()=>{observer.disconnect();timers.forEach(window.clearTimeout);},2500);
   }catch{}
  }

  void focus();
  return()=>{disposed=true;};
 },[]);
 return null;
}
