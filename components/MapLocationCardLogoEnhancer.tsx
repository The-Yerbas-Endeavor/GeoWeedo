'use client';

import {useEffect} from 'react';

export default function MapLocationCardLogoEnhancer(){
 useEffect(()=>{
  let disposed=false;
  const cache=new Map<string,string|null>();

  async function enhance(card:HTMLElement){
   card.querySelector('.map-location-badges')?.remove();
   const locationId=String(card.dataset.locationId||'').trim();
   if(!locationId||card.dataset.logoEnhancerId===locationId)return;
   card.dataset.logoEnhancerId=locationId;
   let path:string|null=cache.get(locationId)??null;
   if(!cache.has(locationId)){
    try{
     const response=await fetch(`/api/dispensary-logo?locationId=${encodeURIComponent(locationId)}`,{cache:'no-store'});
     const data=response.ok?await response.json():null;
     path=typeof data?.logo?.path==='string'?data.logo.path:null;
    }catch{path=null;}
    cache.set(locationId,path);
   }
   if(disposed||!card.isConnected||card.dataset.logoEnhancerId!==locationId)return;
   card.querySelector('.map-location-logo')?.remove();
   if(!path)return;
   const logo=document.createElement('img');
   logo.className='map-location-logo';
   logo.src=path;
   logo.alt=`${card.querySelector('h3')?.textContent?.trim()||'Dispensary'} logo`;
   Object.assign(logo.style,{display:'block',width:'76px',height:'76px',objectFit:'contain',margin:'10px 0 12px',padding:'7px',borderRadius:'14px',border:'1px solid rgba(103,214,110,.30)',boxShadow:'0 8px 24px rgba(0,0,0,.24)'});
   const title=card.querySelector('h3');
   if(title)title.insertAdjacentElement('beforebegin',logo);
   else card.prepend(logo);
  }

  function scan(){document.querySelectorAll<HTMLElement>('.map-location-card').forEach(card=>void enhance(card));}
  const observer=new MutationObserver(scan);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-location-id']});
  scan();
  return()=>{disposed=true;observer.disconnect();};
 },[]);
 return null;
}
