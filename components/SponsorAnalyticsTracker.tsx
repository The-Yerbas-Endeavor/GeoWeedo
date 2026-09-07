'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

type SponsorEventType='pin_impression'|'pin_click'|'listing_view'|'website_click'|'menu_click'|'directions_click'|'game_impression'|'game_completed';

function sendEvent(dispensaryId:string,eventType:SponsorEventType,metadata?:Record<string,unknown>,dedupeKey?:string){
 if(!dispensaryId)return;
 const key=dedupeKey?`geoweedo-sponsor-event:${dedupeKey}`:'';
 if(key){try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1');}catch{}}
 void fetch('/api/sponsorship/event',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({dispensaryId,eventType,metadata})}).catch(()=>{});
}
function identifierFromProfile(pathname:string){const match=pathname.match(/^\/dispensary\/([^/?#]+)/);return match?decodeURIComponent(match[1]):'';}
function locationFromHref(href:string){try{const url=new URL(href,window.location.origin);return url.searchParams.get('location')||'';}catch{return'';}}
function dailyLocationFromDocument(){const link=Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="?location="]')).find(a=>/view location/i.test(a.textContent||''));return link?locationFromHref(link.href):'';}

export default function SponsorAnalyticsTracker(){
 const pathname=usePathname();
 useEffect(()=>{
  const profileIdentifier=identifierFromProfile(pathname);
  if(profileIdentifier)sendEvent(profileIdentifier,'listing_view',{surface:'dispensary_profile'},`listing:${profileIdentifier}`);

  if(pathname==='/'){
   fetch('/api/dispensaries',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{
    const items=Array.isArray(data?.dispensaries)?data.dispensaries:[];
    for(const item of items){if(item?.sponsored)sendEvent(String(item.id),'pin_impression',{surface:'home_map',renderer:'maplibre'},`pin-impression:${item.id}`);}
   }).catch(()=>{});
  }
  if(pathname==='/daily'){
   fetch('/api/daily-weedo',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{
    const id=String(data?.location?.id||'');if(id)sendEvent(id,'game_impression',{mode:'daily'},`daily-impression:${data?.date||id}`);
   }).catch(()=>{});
  }

  const onClick=(event:MouseEvent)=>{
   const target=event.target instanceof Element?event.target:null;if(!target)return;
   const anchor=target.closest('a') as HTMLAnchorElement|null;
   const card=target.closest<HTMLElement>('.map-location-card');
   const row=target.closest('.map-browser-row');
   const profile=identifierFromProfile(window.location.pathname);
   if(card?.dataset.locationId)sendEvent(card.dataset.locationId,'pin_click',{surface:'map_location_card'});
   if(row){window.setTimeout(()=>{const selected=document.querySelector<HTMLElement>('.map-location-card[data-location-id]');if(selected?.dataset.locationId)sendEvent(selected.dataset.locationId,'pin_click',{surface:'map_browser_row'});},0);}
   if(!anchor)return;
   const text=(anchor.textContent||'').trim().toLowerCase();
   const mapProfile=anchor.matches('.map-community-profile-link')?anchor.getAttribute('href')||'':'';
   const linkedProfile=mapProfile.match(/^\/dispensary\/([^/?#]+)/)?.[1];
   if(linkedProfile)sendEvent(decodeURIComponent(linkedProfile),'pin_click',{surface:'map_profile_link'});
   const id=profile||dailyLocationFromDocument();if(!id)return;
   if(/menu/.test(text))sendEvent(id,'menu_click',{surface:profile?'dispensary_profile':'daily'});
   else if(/direction|navigate|get there/.test(text)||/google\.com\/maps|maps\.apple\.com/i.test(anchor.href))sendEvent(id,'directions_click',{surface:profile?'dispensary_profile':'daily'});
   else if(anchor.target==='_blank'&&/^https?:/i.test(anchor.href))sendEvent(id,'website_click',{surface:profile?'dispensary_profile':'daily'});
  };
  document.addEventListener('click',onClick,true);

  const observer=new MutationObserver(()=>{
   if(pathname==='/daily'){
    const id=dailyLocationFromDocument();if(id)sendEvent(id,'game_completed',{mode:'daily'},`daily-complete:${id}:${new Date().toISOString().slice(0,10)}`);
   }
  });
  observer.observe(document.body,{childList:true,subtree:true});
  return()=>{document.removeEventListener('click',onClick,true);observer.disconnect();};
 },[pathname]);
 return null;
}
