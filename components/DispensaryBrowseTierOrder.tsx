'use client';

import {useEffect} from 'react';

type Item={name:string;city?:string;region?:string;sponsored?:boolean;claimed?:boolean};
const norm=(v:unknown)=>String(v||'').trim().toLowerCase();
const key=(name:unknown,city:unknown,region:unknown)=>`${norm(name)}|${norm(city)}|${norm(region)}`;

export default function DispensaryBrowseTierOrder(){
 useEffect(()=>{
  let disposed=false,timer:number|undefined;
  const tiers=new Map<string,number>();
  const labels=new Map<string,string>();

  const ensureThemeChooser=()=>{
   const panel=document.querySelector<HTMLElement>('.map-browser-panel');
   if(!panel||panel.querySelector('.map-browser-theme-chooser'))return;
   const head=panel.querySelector<HTMLElement>('.map-browser-panel-head');
   if(!head)return;

   const chooser=document.createElement('div');
   chooser.className='map-browser-theme-chooser';
   chooser.innerHTML=`<img src="/assets/geoweedo/geoweedo-logo-horizontal-dark.png" alt="GeoWeedo" class="map-browser-theme-logo"><div class="map-browser-theme-copy"><strong>CHOOSE YOUR GEOWEEDO EXPERIENCE</strong><small>Play the discovery game or search real dispensaries.</small></div><div class="map-browser-theme-actions"><button type="button" class="map-browser-theme-play">PLAY</button><button type="button" class="map-browser-theme-search active">SEARCH</button></div>`;

   chooser.querySelector<HTMLButtonElement>('.map-browser-theme-play')?.addEventListener('click',()=>{
    document.querySelector<HTMLButtonElement>('button[aria-label="Show game intro"]')?.click();
    panel.querySelector<HTMLButtonElement>('.map-browser-panel-head button')?.click();
   });
   chooser.querySelector<HTMLButtonElement>('.map-browser-theme-search')?.addEventListener('click',()=>{
    document.querySelector<HTMLInputElement>('.map-browser-tools input')?.focus();
    panel.querySelector<HTMLElement>('.map-browser-list')?.scrollTo({top:0,behavior:'smooth'});
   });
   head.insertAdjacentElement('afterend',chooser);
  };

  const scan=()=>{
   if(disposed)return;
   ensureThemeChooser();
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
  return()=>{disposed=true;window.clearTimeout(timer);observer.disconnect();};
 },[]);
 return null;
}
