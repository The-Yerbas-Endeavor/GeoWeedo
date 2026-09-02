'use client';

import { useEffect } from 'react';

export default function EnabledDispensaryBrowseFilter(){
 useEffect(()=>{
  let cancelled=false;
  let mode:'all'|'enabled'='all';
  let timer:number|undefined;

  const publishScope=()=>{
   document.documentElement.dataset.geoweedoBrowseScope=mode==='enabled'?'listed':'all';
   window.dispatchEvent(new CustomEvent('geoweedo:browse-scope-change',{detail:{scope:mode==='enabled'?'listed':'all'}}));
  };

  const syncControl=(button:HTMLButtonElement)=>{
   const listed=mode==='enabled';
   button.classList.toggle('active',listed);
   button.setAttribute('aria-pressed',listed?'true':'false');
   button.textContent=listed?'All':'Listed';
   button.title=listed?'Show all mapped locations':'Show listed gameplay dispensaries only';
  };

  const syncListToggle=()=>{
   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');
   if(!tools)return;
   const listButton=Array.from(tools.querySelectorAll<HTMLButtonElement>('button')).find(item=>/^(hide list|list \()/i.test((item.textContent||'').trim()));
   if(!listButton)return;
   const isHide=/^hide list$/i.test((listButton.textContent||'').trim());
   listButton.style.display=isHide?'none':'';
   listButton.setAttribute('aria-hidden',isHide?'true':'false');
   listButton.tabIndex=isHide?-1:0;
  };

  const ensureToolbarButton=()=>{
   const tools=document.querySelector<HTMLElement>('.map-first-home .map-browser-tools');
   if(!tools)return null;
   let button=tools.querySelector<HTMLButtonElement>('.map-enabled-filter-button');
   if(button){syncControl(button);return button;}
   button=document.createElement('button');
   button.type='button';
   button.className='map-enabled-filter-button';
   syncControl(button);
   const listButton=Array.from(tools.querySelectorAll<HTMLButtonElement>('button')).find(item=>/^(hide list|list \()/i.test((item.textContent||'').trim()));
   if(listButton)tools.insertBefore(button,listButton);else tools.appendChild(button);
   button.addEventListener('click',()=>{
    mode=mode==='enabled'?'all':'enabled';
    syncControl(button!);
    publishScope();
    apply();
   });
   return button;
  };

  const removePanelTabs=()=>document.querySelectorAll('.map-browser-scope-tabs').forEach(node=>node.remove());
  const rowIsListed=(row:HTMLElement)=>{
   const status=(row.querySelector<HTMLElement>('.map-browser-row-status')?.textContent||'').trim().toUpperCase();
   return status==='PLAY'||status==='★';
  };

  const ensureListedRowsRendered=()=>{
   if(mode!=='enabled')return false;
   const collapsed=Array.from(document.querySelectorAll<HTMLButtonElement>('.map-browser-state-head[aria-expanded="false"]'));
   if(!collapsed.length)return false;
   collapsed.forEach(button=>button.click());
   window.clearTimeout(timer);
   timer=window.setTimeout(apply,40);
   return true;
  };

  const apply=()=>{
   if(cancelled||!document.querySelector('.map-first-home'))return;
   removePanelTabs();
   syncListToggle();
   const control=ensureToolbarButton();
   if(control)syncControl(control);

   if(ensureListedRowsRendered())return;

   const panel=document.querySelector<HTMLElement>('.map-browser-panel');

   document.querySelectorAll<HTMLElement>('.maplibregl-marker[data-location-identity]').forEach(marker=>{
    if(!marker.dataset.enabledFilterOriginalDisplay)marker.dataset.enabledFilterOriginalDisplay=marker.style.display||'__empty__';
    const listed=marker.dataset.pinPriority==='gameplay'||marker.dataset.pinPriority==='sponsored';
    if(mode==='enabled')marker.style.setProperty('display',listed?'':'none','important');
    else{
     const original=marker.dataset.enabledFilterOriginalDisplay;
     if(original==='__empty__')marker.style.removeProperty('display');
     else if(original!==undefined)marker.style.display=original;
    }
   });

   let visibleRows=0;
   const visibleStates=new Set<string>();
   document.querySelectorAll<HTMLElement>('.map-browser-state').forEach(section=>{
    const state=section.querySelector<HTMLElement>('.map-browser-state-head strong')?.textContent?.trim()||'';
    let stateVisible=0;
    section.querySelectorAll<HTMLElement>('.map-browser-row').forEach(row=>{
     const show=mode==='all'||rowIsListed(row);
     row.style.display=show?'':'none';
     row.dataset.listedVisible=show?'true':'false';
     if(show){stateVisible++;visibleRows++;visibleStates.add(state);}
    });
    section.style.display=mode==='enabled'&&stateVisible===0?'none':'';
    section.dataset.listedCount=String(stateVisible);
    const count=section.querySelector<HTMLElement>('.map-browser-state-head small');
    if(count){
     if(!count.dataset.enabledFilterOriginal)count.dataset.enabledFilterOriginal=count.textContent||'';
     count.textContent=mode==='enabled'?`${stateVisible.toLocaleString()} listed dispensar${stateVisible===1?'y':'ies'}`:count.dataset.enabledFilterOriginal;
    }
   });

   const summary=panel?.querySelector<HTMLElement>('.map-browser-panel-head strong');
   if(summary){
    if(!summary.dataset.enabledFilterOriginal)summary.dataset.enabledFilterOriginal=summary.textContent||'';
    if(mode==='enabled')summary.textContent=`${visibleRows.toLocaleString()} listed locations · ${visibleStates.size.toLocaleString()} states`;
    else summary.textContent=summary.dataset.enabledFilterOriginal;
   }

   const existingEmpty=panel?.querySelector<HTMLElement>('.enabled-filter-empty');
   if(mode==='enabled'&&panel&&visibleRows===0){
    if(!existingEmpty){
     const list=panel.querySelector<HTMLElement>('.map-browser-list');
     if(list){const node=document.createElement('div');node.className='map-browser-empty enabled-filter-empty';node.textContent='No listed gameplay dispensaries match the active filters.';list.appendChild(node);}
    }
   }else existingEmpty?.remove();

   window.dispatchEvent(new CustomEvent('geoweedo:listed-filter-applied',{detail:{scope:mode==='enabled'?'listed':'all',visibleRows,visibleStates:visibleStates.size}}));
  };

  document.documentElement.dataset.geoweedoBrowseScope='all';
  const observer=new MutationObserver(()=>{
   window.clearTimeout(timer);
   timer=window.setTimeout(apply,30);
  });
  observer.observe(document.body,{subtree:true,childList:true});
  window.addEventListener('resize',apply);
  apply();

  return()=>{cancelled=true;window.clearTimeout(timer);observer.disconnect();window.removeEventListener('resize',apply);delete document.documentElement.dataset.geoweedoBrowseScope;};
 },[]);
 return null;
}
