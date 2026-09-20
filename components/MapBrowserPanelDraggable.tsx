'use client';

import { useEffect } from 'react';

const MINIMIZED_CLASS='map-browser-panel-search-minimized';
const EXPANDED_ATTR='data-search-results-expanded';

function resultRows(panel:HTMLElement){
  return Array.from(panel.querySelectorAll<HTMLElement>('.map-browser-row'));
}

function openSearchResults(panel:HTMLElement){
  const rows=resultRows(panel);
  if(rows.length===1){
    rows[0].querySelector<HTMLButtonElement>('.map-browser-row-map')?.click();
    return;
  }
  if(rows.length>1){
    panel.setAttribute(EXPANDED_ATTR,'1');
    panel.classList.remove(MINIMIZED_CLASS);
    panel.setAttribute('aria-label',`Browse dispensaries — ${rows.length} search results`);
  }
}

function decorateSearchSummary(){
  const panel=document.querySelector<HTMLElement>('.map-first-home .map-browser-panel');
  if(!panel)return;

  // HomeMapUiCleanup intentionally minimizes active search results. Once the
  // user explicitly expands the result panel, keep it expanded while that same
  // search is active even if another map DOM mutation runs the cleanup pass.
  if(panel.getAttribute(EXPANDED_ATTR)==='1'&&panel.classList.contains(MINIMIZED_CLASS)){
    panel.classList.remove(MINIMIZED_CLASS);
  }

  const head=panel.querySelector<HTMLElement>('.map-browser-panel-head');
  const summary=head?.querySelector<HTMLElement>(':scope > div');
  if(!head||!summary)return;
  const rows=resultRows(panel);
  const actionable=panel.classList.contains(MINIMIZED_CLASS)&&rows.length>0;

  if(actionable){
    summary.dataset.searchResultsClickable='1';
    summary.setAttribute('role','button');
    summary.tabIndex=0;
    summary.style.cursor='pointer';
    const firstName=rows[0]?.querySelector<HTMLElement>('.map-browser-row-copy strong')?.textContent?.trim();
    summary.setAttribute('aria-label',rows.length===1
      ? `Open ${firstName||'matching dispensary'}`
      : `Show ${rows.length} matching dispensaries`);
    summary.title=rows.length===1?'Open matching dispensary':'Show matching dispensaries';
  }else{
    delete summary.dataset.searchResultsClickable;
    summary.removeAttribute('role');
    summary.removeAttribute('tabindex');
    summary.removeAttribute('aria-label');
    summary.removeAttribute('title');
    summary.style.removeProperty('cursor');
  }
}

function decorateSelectedCard(){
  const card=document.querySelector<HTMLElement>('.map-first-home .map-location-card');
  if(!card)return;
  const id=String(card.dataset.locationId||'').trim();
  const kind=String(card.dataset.locationKind||'').trim();
  const heading=card.querySelector<HTMLHeadingElement>('h3');
  if(!id||!kind||!heading||heading.querySelector('.map-location-title-link'))return;

  const name=heading.textContent?.trim()||'Dispensary';
  const link=document.createElement('a');
  link.className='map-location-title-link';
  link.href=`/dispensary/${encodeURIComponent(id)}?kind=${encodeURIComponent(kind)}`;
  link.textContent=name;
  link.title=`Open ${name} profile`;
  link.style.color='inherit';
  link.style.textDecoration='none';
  link.style.cursor='pointer';
  heading.textContent='';
  heading.appendChild(link);
}

export default function MapBrowserPanelDraggable(){
  useEffect(()=>{
    const decorate=()=>{
      decorateSearchSummary();
      decorateSelectedCard();
    };

    let dragPanel:HTMLElement|null=null,dragStage:HTMLElement|null=null,offsetX=0,offsetY=0;
    const stopDrag=()=>{
      if(!dragPanel)return;
      dragPanel.classList.remove('map-browser-panel-dragging');
      dragPanel=null;dragStage=null;
      window.removeEventListener('pointermove',onPointerMove);
      window.removeEventListener('pointerup',stopDrag);
      window.removeEventListener('pointercancel',stopDrag);
    };
    const onPointerMove=(event:PointerEvent)=>{
      if(!dragPanel||!dragStage)return;
      const stageRect=dragStage.getBoundingClientRect(),panelRect=dragPanel.getBoundingClientRect();
      const x=Math.max(8,Math.min(event.clientX-stageRect.left-offsetX,Math.max(8,stageRect.width-panelRect.width-8)));
      const y=Math.max(8,Math.min(event.clientY-stageRect.top-offsetY,Math.max(8,stageRect.height-panelRect.height-8)));
      dragPanel.style.setProperty('left',`${x}px`,'important');
      dragPanel.style.setProperty('top',`${y}px`,'important');
      dragPanel.style.setProperty('right','auto','important');
      dragPanel.style.setProperty('bottom','auto','important');
      dragPanel.style.setProperty('transform','none','important');
      dragPanel.classList.add('map-browser-panel-user-positioned');
      event.preventDefault();
    };
    const onPointerDown=(event:PointerEvent)=>{
      if(window.innerWidth<=650||event.button!==0)return;
      const target=event.target as HTMLElement|null;
      const head=target?.closest<HTMLElement>('.map-first-home .map-browser-panel-head');
      if(!head||target?.closest('button,a,input,select,textarea'))return;
      const panel=head.closest<HTMLElement>('.map-browser-panel');
      const stage=panel?.closest<HTMLElement>('.home-map-stage');
      if(!panel||!stage)return;
      const panelRect=panel.getBoundingClientRect();
      offsetX=event.clientX-panelRect.left;
      offsetY=event.clientY-panelRect.top;
      dragPanel=panel;dragStage=stage;
      panel.classList.add('map-browser-panel-dragging','map-browser-panel-user-positioned');
      panel.style.setProperty('left',`${panelRect.left-stage.getBoundingClientRect().left}px`,'important');
      panel.style.setProperty('top',`${panelRect.top-stage.getBoundingClientRect().top}px`,'important');
      panel.style.setProperty('right','auto','important');
      panel.style.setProperty('bottom','auto','important');
      panel.style.setProperty('transform','none','important');
      event.preventDefault();
      window.addEventListener('pointermove',onPointerMove,{passive:false});
      window.addEventListener('pointerup',stopDrag,{once:true});
      window.addEventListener('pointercancel',stopDrag,{once:true});
    };

    const onClick=(event:MouseEvent)=>{
      const target=event.target as HTMLElement|null;
      if(!target)return;
      const summary=target.closest<HTMLElement>('[data-search-results-clickable="1"]');
      if(!summary)return;
      const panel=summary.closest<HTMLElement>('.map-browser-panel');
      if(!panel||!panel.classList.contains(MINIMIZED_CLASS))return;
      event.preventDefault();
      openSearchResults(panel);
    };

    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      const target=event.target as HTMLElement|null;
      const summary=target?.closest<HTMLElement>('[data-search-results-clickable="1"]');
      if(!summary)return;
      const panel=summary.closest<HTMLElement>('.map-browser-panel');
      if(!panel||!panel.classList.contains(MINIMIZED_CLASS))return;
      event.preventDefault();
      openSearchResults(panel);
    };

    const onInput=(event:Event)=>{
      const target=event.target;
      if(!(target instanceof HTMLInputElement)||!target.matches('.map-first-home .map-browser-tools input'))return;
      document.querySelector<HTMLElement>('.map-first-home .map-browser-panel')?.removeAttribute(EXPANDED_ATTR);
      window.setTimeout(decorate,0);
    };

    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('click',onClick);
    document.addEventListener('keydown',onKeyDown);
    document.addEventListener('input',onInput);
    const observer=new MutationObserver(decorate);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-location-id','data-location-kind']});
    decorate();

    return()=>{
      document.removeEventListener('pointerdown',onPointerDown);
      stopDrag();
      document.removeEventListener('click',onClick);
      document.removeEventListener('keydown',onKeyDown);
      document.removeEventListener('input',onInput);
      observer.disconnect();
    };
  },[]);
  return null;
}
