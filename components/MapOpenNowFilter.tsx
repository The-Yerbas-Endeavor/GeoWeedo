'use client';

import {useEffect} from 'react';

function norm(value:string|null|undefined){return String(value||'').trim().toLowerCase();}

export default function MapOpenNowFilter(){
 useEffect(()=>{
  let disposed=false,enabled=false,loading=false,openKeys=new Set<string>(),openNames=new Set<string>(),frame=0;

  const updateButton=()=>{
   const button=document.querySelector<HTMLButtonElement>('[data-geoweedo-open-now]');
   if(!button)return;
   const nextText=loading?'Open now…':enabled?`✓ Open now (${openKeys.size})`:'Open now';
   if(button.textContent!==nextText)button.textContent=nextText;
   const pressed=String(enabled);
   if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);
   if(button.disabled!==loading)button.disabled=loading;
  };

  const apply=()=>{
   if(disposed)return;
   updateButton();
   // Do no row scanning at all until the filter is explicitly enabled.
   if(!enabled){
    document.querySelectorAll<HTMLElement>('[data-geoweedo-open-hidden="1"]').forEach(item=>{
     item.style.removeProperty('display');
     delete item.dataset.geoweedoOpenHidden;
    });
    return;
   }
   document.querySelectorAll<HTMLElement>('.map-browser-row').forEach(row=>{
    const name=norm(row.querySelector('strong')?.textContent),place=norm(row.querySelector('small')?.textContent),exact=`${name}|${place}`;
    const visible=openKeys.has(exact)||openNames.has(name),wrapper=row.parentElement as HTMLElement|null;
    if(!wrapper)return;
    if(visible){wrapper.style.removeProperty('display');delete wrapper.dataset.geoweedoOpenHidden;}
    else{wrapper.style.display='none';wrapper.dataset.geoweedoOpenHidden='1';}
   });
   document.querySelectorAll<HTMLElement>('.map-browser-state-list').forEach(list=>{
    const rows=Array.from(list.querySelectorAll<HTMLElement>('.map-browser-row'));
    const any=rows.some(row=>row.parentElement?.style.display!=='none');
    const group=list.parentElement as HTMLElement|null;
    if(!group)return;
    if(any){group.style.removeProperty('display');delete group.dataset.geoweedoOpenHidden;}
    else{group.style.display='none';group.dataset.geoweedoOpenHidden='1';}
   });
  };

  const ensureButton=()=>{
   const tools=document.querySelector<HTMLElement>('.map-browser-tools');
   if(!tools||tools.querySelector('[data-geoweedo-open-now]'))return false;
   const button=document.createElement('button');
   button.type='button';button.dataset.geoweedoOpenNow='1';button.textContent='Open now';button.setAttribute('aria-pressed','false');
   button.addEventListener('click',async()=>{
    if(enabled){enabled=false;apply();return;}
    loading=true;updateButton();
    try{
     const response=await fetch('/api/dispensaries/open-now',{cache:'no-store'}),data=await response.json();
     if(!response.ok)throw new Error(data.error||'Could not check hours.');
     openKeys=new Set((data.openKeys||[]).map((value:string)=>norm(value)));
     openNames=new Set(Array.from(openKeys).map(value=>value.split('|')[0]));
     enabled=true;
    }catch{enabled=false;}finally{loading=false;apply();}
   });
   const nearMe=Array.from(tools.querySelectorAll('button')).find(item=>/near me/i.test(item.textContent||''));
   if(nearMe)tools.insertBefore(button,nearMe);else tools.appendChild(button);
   return true;
  };

  const scheduleScan=()=>{
   if(disposed||frame)return;
   frame=window.requestAnimationFrame(()=>{
    frame=0;
    ensureButton();
    // New browse rows only need processing while Open Now is active.
    if(enabled)apply();
   });
  };

  const observer=new MutationObserver(scheduleScan);
  observer.observe(document.body,{childList:true,subtree:true});
  scheduleScan();
  return()=>{
   disposed=true;observer.disconnect();if(frame)window.cancelAnimationFrame(frame);
   document.querySelector('[data-geoweedo-open-now]')?.remove();
   document.querySelectorAll<HTMLElement>('[data-geoweedo-open-hidden="1"]').forEach(item=>{item.style.removeProperty('display');delete item.dataset.geoweedoOpenHidden;});
  };
 },[]);
 return null;
}
