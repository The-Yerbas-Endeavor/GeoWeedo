'use client';

import {useEffect} from 'react';

function norm(value:string|null|undefined){return String(value||'').trim().toLowerCase();}

export default function MapOpenNowFilter(){
 useEffect(()=>{
  let disposed=false,enabled=false,loading=false,openKeys=new Set<string>(),openNames=new Set<string>();
  const apply=()=>{
   if(disposed)return;
   document.querySelectorAll<HTMLElement>('.map-browser-row').forEach(row=>{
    if(!enabled){row.parentElement?.style.removeProperty('display');return;}
    const name=norm(row.querySelector('strong')?.textContent),place=norm(row.querySelector('small')?.textContent),exact=`${name}|${place}`;
    const visible=openKeys.has(exact)||openNames.has(name);
    if(row.parentElement)row.parentElement.style.display=visible?'':'none';
   });
   document.querySelectorAll<HTMLElement>('.map-browser-state-list').forEach(list=>{
    const rows=Array.from(list.querySelectorAll<HTMLElement>('.map-browser-row'));
    const any=rows.some(row=>row.parentElement?.style.display!=='none');
    const group=list.parentElement as HTMLElement|null;
    if(group)group.style.display=enabled&&!any?'none':'';
   });
   const button=document.querySelector<HTMLButtonElement>('[data-geoweedo-open-now]');
   if(button){button.textContent=loading?'Open now…':enabled?`✓ Open now (${openKeys.size})`:'Open now';button.setAttribute('aria-pressed',String(enabled));button.disabled=loading;}
  };
  const ensureButton=()=>{
   const tools=document.querySelector<HTMLElement>('.map-browser-tools');
   if(!tools)return;
   if(tools.querySelector('[data-geoweedo-open-now]'))return;
   const button=document.createElement('button');button.type='button';button.dataset.geoweedoOpenNow='1';button.textContent='Open now';button.setAttribute('aria-pressed','false');
   button.addEventListener('click',async()=>{
    if(enabled){enabled=false;apply();return;}
    loading=true;apply();
    try{const response=await fetch('/api/dispensaries/open-now',{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not check hours.');openKeys=new Set((data.openKeys||[]).map((value:string)=>norm(value)));openNames=new Set(Array.from(openKeys).map(value=>value.split('|')[0]));enabled=true;}catch{enabled=false;}finally{loading=false;apply();}
   });
   const nearMe=Array.from(tools.querySelectorAll('button')).find(item=>/near me/i.test(item.textContent||''));if(nearMe)tools.insertBefore(button,nearMe);else tools.appendChild(button);apply();
  };
  const scan=()=>{ensureButton();apply();};
  const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true});scan();
  return()=>{disposed=true;observer.disconnect();document.querySelector('[data-geoweedo-open-now]')?.remove();document.querySelectorAll<HTMLElement>('.map-browser-row').forEach(row=>row.parentElement?.style.removeProperty('display'));document.querySelectorAll<HTMLElement>('.map-browser-state-list').forEach(list=>(list.parentElement as HTMLElement|null)?.style.removeProperty('display'));};
 },[]);
 return null;
}
