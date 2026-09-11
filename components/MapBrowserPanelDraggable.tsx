'use client';

import { useEffect } from 'react';

const MINIMIZED_CLASS='map-browser-panel-search-minimized';
const EXPANDED_ATTR='data-search-results-expanded';

function resultRows(panel:HTMLElement){
  return Array.from(panel.querySelectorAll<HTMLButtonElement>('.map-browser-row:not(:disabled)'));
}

function openSearchResults(panel:HTMLElement){
  const rows=resultRows(panel);
  if(rows.length===1){
    rows[0].click();
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

    document.addEventListener('click',onClick);
    document.addEventListener('keydown',onKeyDown);
    document.addEventListener('input',onInput);
    const observer=new MutationObserver(decorate);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-location-id','data-location-kind']});
    decorate();

    return()=>{
      document.removeEventListener('click',onClick);
      document.removeEventListener('keydown',onKeyDown);
      document.removeEventListener('input',onInput);
      observer.disconnect();
    };
  },[]);
  return null;
}
