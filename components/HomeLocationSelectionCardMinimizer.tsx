'use client';

import { useEffect } from 'react';

export default function HomeLocationSelectionCardMinimizer(){
 useEffect(()=>{
  const minimize=()=>{
   const close=document.querySelector<HTMLButtonElement>('.home-play-card button[aria-label="Close game intro"]');
   if(close)close.click();
  };

  if(new URLSearchParams(window.location.search).has('location'))minimize();

  const onClick=(event:MouseEvent)=>{
   const target=event.target as Element|null;
   if(!target)return;
   if(target.closest('.map-browser-row')||target.closest('.maplibregl-marker[data-location-identity]')||target.closest('.map-location-focus'))minimize();
  };
  document.addEventListener('click',onClick,true);
  return()=>document.removeEventListener('click',onClick,true);
 },[]);
 return null;
}
