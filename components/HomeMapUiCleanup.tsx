'use client';

import { useLayoutEffect } from 'react';

const FINDO_ACTIVE_CLASS='geoweedo-findo-active';
const BROWSE_OPEN_CLASS='geoweedo-browse-panel-open';

function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}

function openBrowsePanel(){
  let attempts=0;
  const tryOpen=()=>{
    const panel=document.querySelector<HTMLElement>('.map-first-home .map-browser-panel');
    if(panel){
      panel.dataset.userExpanded='1';
      panel.classList.remove('map-browser-panel-search-minimized','map-browser-panel-minimized');
      panel.setAttribute('aria-label','Browse dispensaries');
      if(window.innerWidth>650){
        panel.classList.add('map-browser-panel-centered');
        panel.style.left='50%';
        panel.style.top='50%';
        panel.style.right='auto';
        panel.style.bottom='auto';
        panel.style.transform='translate(-50%,-50%)';
      }
      return;
    }
    window.dispatchEvent(new CustomEvent('geoweedo:open-browse-panel',{detail:{source:'ui-cleanup'}}));
    attempts+=1;if(attempts<20)window.setTimeout(tryOpen,50);
  };
  tryOpen();
}

function activateFindo(){
  document.body.classList.add(FINDO_ACTIVE_CLASS);
  openBrowsePanel();
}

function zoomHomeMapOnce(){
  const canvas=document.querySelector<HTMLElement>('.map-first-home .maplibregl-map');
  if(!canvas||canvas.dataset.homeZoomApplied==='1')return;
  const zoomIn=document.querySelector<HTMLButtonElement>('.map-first-home .maplibregl-ctrl-zoom-in');
  if(!zoomIn)return;
  canvas.dataset.homeZoomApplied='1';zoomIn.click();
}

function isMobileHome(){
  return document.body.classList.contains('mobile-home')||window.matchMedia('(max-width: 820px)').matches;
}

function minimizeGameplayCard(){
  const introClose=document.querySelector<HTMLButtonElement>('.map-first-home .home-play-card button[aria-label="Close game intro"]');
  if(introClose){introClose.click();return;}
  const promo=document.querySelector<HTMLElement>('.map-first-home .home-play-card-promo');
  promo?.querySelector<HTMLButtonElement>('.home-promo-close')?.click();
}

function centerBrowsePanel(){
  let attempts=0;
  const center=()=>{
    const panel=document.querySelector<HTMLElement>('.map-first-home .map-browser-panel');
    if(!panel){
      attempts+=1;
      if(attempts<20)window.setTimeout(center,40);
      return;
    }
    panel.dataset.userExpanded='1';
    panel.classList.add('map-browser-panel-centered');
    panel.classList.remove('map-browser-panel-search-minimized','map-browser-panel-dragging');
    panel.setAttribute('aria-label','Browse dispensaries');
    if(window.innerWidth>650){
      panel.style.left='50%';
      panel.style.top='50%';
      panel.style.right='auto';
      panel.style.bottom='auto';
      panel.style.transform='translate(-50%,-50%)';
    }
  };
  window.setTimeout(center,0);
}

function syncBrowseOpenState(){
  const panel=document.querySelector<HTMLElement>('.map-first-home .map-browser-panel');
  document.body.classList.toggle(BROWSE_OPEN_CLASS,Boolean(panel));
}

function removeLegacyPromoSearch(card:HTMLElement){card.querySelectorAll<HTMLElement>('.home-promo-search').forEach(button=>button.remove());card.removeAttribute('data-search-bound');}

function bindPromoDrag(card:HTMLElement){
  if(card.dataset.dragBound==='1')return;card.dataset.dragBound='1';card.classList.add('home-promo-draggable');
  if(window.innerWidth>650){card.style.left='50%';card.style.top='50%';card.style.right='auto';card.style.bottom='auto';card.style.transform='translate(-50%,-50%)';}
  let dragging=false,offsetX=0,offsetY=0,stage:HTMLElement|null=null;
  const move=(event:PointerEvent)=>{if(!dragging||!stage)return;const stageRect=stage.getBoundingClientRect(),cardRect=card.getBoundingClientRect();const x=clamp(event.clientX-stageRect.left-offsetX,8,Math.max(8,stageRect.width-cardRect.width-8));const y=clamp(event.clientY-stageRect.top-offsetY,8,Math.max(8,stageRect.height-cardRect.height-8));card.style.left=`${x}px`;card.style.top=`${y}px`;card.style.right='auto';card.style.bottom='auto';card.style.transform='none';};
  const stop=()=>{if(!dragging)return;dragging=false;card.classList.remove('home-promo-dragging');window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);};
  card.addEventListener('pointerdown',(event)=>{if(window.innerWidth<=650||event.button!==0)return;const target=event.target as HTMLElement|null;if(target?.closest('button,a,input,select,textarea,[role="button"]'))return;stage=card.closest<HTMLElement>('.home-map-stage');if(!stage)return;const rect=card.getBoundingClientRect();offsetX=event.clientX-rect.left;offsetY=event.clientY-rect.top;dragging=true;card.classList.add('home-promo-dragging');event.preventDefault();card.style.left=`${rect.left-stage.getBoundingClientRect().left}px`;card.style.top=`${rect.top-stage.getBoundingClientRect().top}px`;card.style.right='auto';card.style.bottom='auto';card.style.transform='none';window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',stop,{once:true});window.addEventListener('pointercancel',stop,{once:true});});
}

export default function HomeMapUiCleanup(){
  useLayoutEffect(()=>{
    let browseInitialized=false,promoInitialized=false;
    const initializeBrowsePanel=()=>{
      if(browseInitialized)return;
      const panel=document.querySelector<HTMLElement>('.map-first-home .map-browser-panel');
      if(!panel)return;
      browseInitialized=true;
      document.body.classList.add('geoweedo-home-browse-ready');
      if(document.body.classList.contains(FINDO_ACTIVE_CLASS)){
        panel.classList.remove('map-browser-panel-search-minimized');
        panel.setAttribute('aria-label','Browse dispensaries');
      }
    };
    const initializePromo=()=>{if(promoInitialized)return;const card=document.querySelector<HTMLElement>('.map-first-home .home-play-card-promo');if(card){promoInitialized=true;return;}const collapsed=document.querySelector<HTMLButtonElement>('.map-first-home button[aria-label="Show game intro"]');if(!collapsed)return;promoInitialized=true;collapsed.click();};
    const bind=()=>{initializeBrowsePanel();initializePromo();zoomHomeMapOnce();syncBrowseOpenState();const card=document.querySelector<HTMLElement>('.map-first-home .home-play-card-promo');if(card){removeLegacyPromoSearch(card);bindPromoDrag(card);}};
    const onClick=(event:MouseEvent)=>{const target=event.target as HTMLElement|null;if(target?.closest('.map-first-home button[aria-label="Findo GeoWeedo on the dispensary map"]'))window.setTimeout(activateFindo,0);const head=target?.closest<HTMLElement>('.map-first-home .map-browser-panel-head');if(head&&!target?.closest('.map-browser-panel-head>button')){const panel=head.closest<HTMLElement>('.map-browser-panel');if(panel){panel.dataset.userExpanded='1';panel.classList.remove('map-browser-panel-search-minimized');panel.setAttribute('aria-label','Browse dispensaries');}}};
    const onChange=(event:Event)=>{const target=event.target;if(target instanceof HTMLSelectElement&&target.matches('.map-first-home .map-browser-tools select[aria-label="Filter by state"]')&&target.value!=='all')minimizeGameplayCard();};
    const onFocusIn=(event:FocusEvent)=>{const target=event.target;if(!isMobileHome()||!(target instanceof HTMLInputElement)||!target.matches('.map-first-home .map-unified-search-input'))return;minimizeGameplayCard();};
    document.addEventListener('click',onClick);document.addEventListener('change',onChange);document.addEventListener('focusin',onFocusIn);
    bind();const observer=new MutationObserver(bind);observer.observe(document.body,{subtree:true,childList:true});
    const fallback=window.setTimeout(()=>document.body.classList.add('geoweedo-home-browse-ready'),600);
    return()=>{document.removeEventListener('click',onClick);document.removeEventListener('change',onChange);document.removeEventListener('focusin',onFocusIn);observer.disconnect();window.clearTimeout(fallback);document.body.classList.remove('geoweedo-home-browse-ready',FINDO_ACTIVE_CLASS,BROWSE_OPEN_CLASS);};
  },[]);
  return null;
}
