'use client';

import { useEffect } from 'react';

export default function HomeMapLocationDeepLink(){
 useEffect(()=>{
  const profileMatch=window.location.pathname.match(/^\/dispensary\/([^/]+)/);
  if(!profileMatch)return;
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
  if(rewrite())return;
  const observer=new MutationObserver(()=>{if(rewrite())observer.disconnect();});
  observer.observe(document.body,{childList:true,subtree:true});
  const timer=window.setTimeout(()=>observer.disconnect(),5000);
  return()=>{observer.disconnect();window.clearTimeout(timer);};
 },[]);
 return null;
}
