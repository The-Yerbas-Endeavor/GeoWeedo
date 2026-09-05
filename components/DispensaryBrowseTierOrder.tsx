'use client';

import {useEffect} from 'react';

type Item={name:string;city?:string;region?:string;sponsored?:boolean;claimed?:boolean};
const norm=(v:unknown)=>String(v||'').trim().toLowerCase();
const key=(name:unknown,city:unknown,region:unknown)=>`${norm(name)}|${norm(city)}|${norm(region)}`;

export default function DispensaryBrowseTierOrder(){
 useEffect(()=>{
  let disposed=false,timer:number|undefined,searchMode=false;
  const tiers=new Map<string,number>();
  const labels=new Map<string,string>();

  const syncExperienceCard=()=>{
   document.querySelectorAll('.map-browser-theme-chooser').forEach(node=>node.remove());
   const panel=document.querySelector<HTMLElement>('.map-browser-panel');
   const promo=document.querySelector<HTMLElement>('.home-play-card-promo');
   if(promo){
    searchMode=false;
    if(panel){panel.style.display='none';panel.classList.remove('map-browser-search-promo');}
    const play=promo.querySelector<HTMLButtonElement>('.home-promo-play');
    if(play&&!promo.querySelector('.home-promo-search')){
     const search=document.createElement('button');
     search.type='button';
     search.className='secondary home-promo-search';
     search.textContent='Search Dispensaries';
     search.addEventListener('click',()=>{
      searchMode=true;
      if(panel){panel.style.display='';panel.classList.add('map-browser-search-promo');}
      promo.querySelector<HTMLButtonElement>('button[aria-label="Close game intro"]')?.click();
      window.setTimeout(()=>{
       const currentPanel=document.querySelector<HTMLElement>('.map-browser-panel');
       if(currentPanel){currentPanel.style.display='';currentPanel.classList.add('map-browser-search-promo');}
       document.querySelector<HTMLInputElement>('.map-browser-tools input')?.focus();
      },0);
     });
     play.insertAdjacentElement('afterend',search);
    }
   }else if(panel){
    panel.style.display='';
    panel.classList.toggle('map-browser-search-promo',searchMode);
   }
  };

  const scan=()=>{
   if(disposed)return;
   syncExperienceCard();
   document.querySelectorAll<HTMLElement>('.map-browser-row-status').forEach(status=>{
    if(status.textContent?.trim().toUpperCase()==='PLAY')status.textContent='ENABLED';
   });
   if(!tiers.size)return;
   document.querySelectorAll<HTMLElement>('.map-browser-state').forEach(section=>{
    const state=section.querySelector('.map-browser-state-head strong')?.textContent?.trim()||'';
    const rows=Array.from(section.querySelectorAll<HTMLElement>(':scope > .map-browser-row'));
    if(!rows.length)return;
    const ranked=rows.map((row,index)=>{
     const name=row.querySelector('.map-browser-row-copy strong')?.textContent?.trim()||'';
     const city=row.querySelector('.map-browser-row-copy small')?.textContent?.trim()||'';
     const k=key(name,city,state),rank=tiers.get(k)??0,label=labels.get(k)||'Mapped';
     row.dataset.profileTier=String(rank);
     let badge=row.querySelector<HTMLElement>('.map-profile-tier-badge');
     if(rank>0){if(!badge){badge=document.createElement('span');badge.className='map-profile-tier-badge';row.querySelector('.map-browser-row-copy')?.appendChild(badge);}badge.textContent=label;badge.dataset.tier=String(rank);}else badge?.remove();
     return{row,index,rank};
    }).sort((a,b)=>b.rank-a.rank||a.index-b.index);
    const current=rows;if(ranked.some((x,i)=>current[i]!==x.row))ranked.forEach(x=>section.appendChild(x.row));
   });
  };

  fetch('/api/dispensaries',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{
   if(disposed)return;
   for(const item of (data.dispensaries||[]) as Item[]){const rank=item.sponsored&&item.claimed?4:item.claimed?3:2;const k=key(item.name,item.city,item.region);tiers.set(k,rank);labels.set(k,rank===4?'SPONSORED + CLAIMED':rank===3?'CLAIMED / LISTED':'LISTED');}
   scan();
  }).catch(()=>{});
  scan();
  const observer=new MutationObserver(()=>{window.clearTimeout(timer);timer=window.setTimeout(scan,50);});observer.observe(document.body,{childList:true,subtree:true});
  return()=>{disposed=true;window.clearTimeout(timer);observer.disconnect();const panel=document.querySelector<HTMLElement>('.map-browser-panel');panel?.style.removeProperty('display');panel?.classList.remove('map-browser-search-promo');};
 },[]);
 return null;
}
