'use client';

import {useEffect} from 'react';

type SponsorLogo={locationId:string;markerTitle:string;logoUrl:string};

export default function SponsoredMapLogoEnhancer(){
 useEffect(()=>{
  if(window.location.pathname!=='/')return;
  let cancelled=false;
  let observer:MutationObserver|null=null;
  let raf=0;
  fetch('/api/map-sponsor-logos',{cache:'no-store'})
   .then(r=>r.ok?r.json():Promise.reject())
   .then(data=>{
    if(cancelled)return;
    const items=Array.isArray(data?.logos)?data.logos as SponsorLogo[]:[];
    const logos=new Map(items.map(item=>[item.markerTitle,item.logoUrl]));
    const apply=()=>{
     raf=0;
     document.querySelectorAll<HTMLElement>('.home-map-canvas .maplibregl-marker.geoweedo-enabled-marker[title]').forEach(marker=>{
      const logoUrl=logos.get(marker.title);
      const image=marker.querySelector<HTMLImageElement>('img.geoweedo-branded-pin');
      if(!logoUrl||!image)return;
      if(image.dataset.sponsorLogo===logoUrl)return;
      marker.classList.add('geoweedo-sponsored-marker');
      image.classList.add('geoweedo-sponsored-logo');
      image.dataset.sponsorLogo=logoUrl;
      image.onerror=()=>{
       image.onerror=null;
       delete image.dataset.sponsorLogo;
       image.classList.remove('geoweedo-sponsored-logo');
       marker.classList.remove('geoweedo-sponsored-marker');
       image.src='/assets/geoweedo/geoweedo-map-marker.png';
      };
      image.src=logoUrl;
     });
    };
    const schedule=()=>{if(!raf)raf=window.requestAnimationFrame(apply);};
    apply();
    observer=new MutationObserver(schedule);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['title']});
   })
   .catch(()=>{});
  return()=>{cancelled=true;observer?.disconnect();if(raf)window.cancelAnimationFrame(raf);};
 },[]);
 return null;
}
