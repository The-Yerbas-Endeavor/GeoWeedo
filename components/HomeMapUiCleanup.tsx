'use client';

import { useLayoutEffect } from 'react';

const POSITION_KEY='geoweedo_home_promo_position';

type StoredPosition={x:number;y:number};

function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}

function applyStoredPosition(card:HTMLElement){
  if(window.innerWidth<=650)return;
  try{
    const raw=sessionStorage.getItem(POSITION_KEY);
    if(!raw)return;
    const saved=JSON.parse(raw) as StoredPosition;
    if(!Number.isFinite(saved.x)||!Number.isFinite(saved.y))return;
    const stage=card.closest<HTMLElement>('.home-map-stage');
    if(!stage)return;
    const stageRect=stage.getBoundingClientRect();
    const cardRect=card.getBoundingClientRect();
    const x=clamp(saved.x,8,Math.max(8,stageRect.width-cardRect.width-8));
    const y=clamp(saved.y,8,Math.max(8,stageRect.height-cardRect.height-8));
    card.style.left=`${x}px`;
    card.style.top=`${y}px`;
    card.style.right='auto';
    card.style.bottom='auto';
    card.style.transform='none';
  }catch{}
}

function openBrowsePanel(){
  const listButton=Array.from(document.querySelectorAll<HTMLButtonElement>('.map-first-home .map-browser-tools button')).find(button=>/^(List|Hide list)/i.test(button.textContent?.trim()||''));
  if(listButton&&/^List/i.test(listButton.textContent?.trim()||''))listButton.click();
}

function minimizeSearchPanels(active:boolean){
  if(active){
    const promo=document.querySelector<HTMLElement>('.map-first-home .home-play-card-promo');
    promo?.querySelector<HTMLButtonElement>('.home-promo-close')?.click();
  }
  const browser=document.querySelector<HTMLElement>('.map-first-home .map-browser-panel');
  browser?.classList.toggle('map-browser-panel-search-minimized',active);
  if(browser){
    if(active)browser.setAttribute('aria-label','Browse dispensaries — minimized search results');
    else browser.setAttribute('aria-label','Browse dispensaries');
  }
}

function bindSearchAction(card:HTMLElement){
  if(card.dataset.searchBound==='1')return;
  card.dataset.searchBound='1';
  const shell=card.querySelector<HTMLElement>('.home-promo-shell');
  if(!shell)return;
  let search=shell.querySelector<HTMLButtonElement>('.home-promo-search');
  const play=shell.querySelector<HTMLElement>('.home-promo-play');
  if(!search){
    search=document.createElement('button');
    search.type='button';
    search.className='home-promo-search';
  }
  search.textContent='Findo Weedo';
  if(play?.parentElement===shell){
    play.insertAdjacentElement('beforebegin',search);
  }else if(!search.parentElement){
    shell.appendChild(search);
  }
  search.addEventListener('click',()=>{
    const close=card.querySelector<HTMLButtonElement>('.home-promo-close');
    close?.click();
    window.setTimeout(openBrowsePanel,0);
  });
}

function bindMapSearch(input:HTMLInputElement){
  if(input.dataset.zipSearchBound==='1')return;
  input.dataset.zipSearchBound='1';
  input.placeholder='Search dispensary or ZIP code';
  input.setAttribute('aria-label','Search dispensary or ZIP code');
  let lookupTimer:number|undefined;
  let lastZip='';
  input.addEventListener('input',()=>{
    window.clearTimeout(lookupTimer);
    const value=input.value.trim();
    minimizeSearchPanels(Boolean(value));
    const zipMatch=value.match(/^\d{5}(?:-\d{4})?$/);
    if(!zipMatch){
      if(lastZip)window.dispatchEvent(new CustomEvent('geoweedo:zip-radius-clear'));
      lastZip='';
      input.removeAttribute('title');
      return;
    }
    const zip=zipMatch[0].slice(0,5);
    if(zip===lastZip)return;
    lookupTimer=window.setTimeout(()=>{
      fetch(`/api/zip-lookup?zip=${encodeURIComponent(zip)}`,{cache:'no-store'})
        .then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'ZIP code not found.');return data;})
        .then(data=>{
          if(input.value.trim().slice(0,5)!==zip)return;
          const latitude=Number(data.latitude),longitude=Number(data.longitude);
          if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw new Error('ZIP coordinates unavailable.');
          lastZip=zip;
          input.title=`Showing mapped dispensaries within 50 miles of ZIP ${zip}`;
          window.dispatchEvent(new CustomEvent('geoweedo:zip-radius',{detail:{zip,lat:latitude,lng:longitude,radiusMiles:50}}));
        })
        .catch(()=>{
          lastZip='';
          window.dispatchEvent(new CustomEvent('geoweedo:zip-radius-clear'));
        });
    },180);
  });
}

function bindPromoDrag(card:HTMLElement){
  if(card.dataset.dragBound==='1')return;
  card.dataset.dragBound='1';
  card.classList.add('home-promo-draggable');
  applyStoredPosition(card);
  let dragging=false,offsetX=0,offsetY=0,stage:HTMLElement|null=null;
  const move=(event:PointerEvent)=>{
    if(!dragging||!stage)return;
    const stageRect=stage.getBoundingClientRect(),cardRect=card.getBoundingClientRect();
    const x=clamp(event.clientX-stageRect.left-offsetX,8,Math.max(8,stageRect.width-cardRect.width-8));
    const y=clamp(event.clientY-stageRect.top-offsetY,8,Math.max(8,stageRect.height-cardRect.height-8));
    card.style.left=`${x}px`;card.style.top=`${y}px`;card.style.right='auto';card.style.bottom='auto';card.style.transform='none';
  };
  const stop=()=>{
    if(!dragging)return;
    dragging=false;card.classList.remove('home-promo-dragging');
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);
    const x=parseFloat(card.style.left),y=parseFloat(card.style.top);
    if(Number.isFinite(x)&&Number.isFinite(y)){try{sessionStorage.setItem(POSITION_KEY,JSON.stringify({x,y}));}catch{}}
  };
  card.addEventListener('pointerdown',(event)=>{
    if(window.innerWidth<=650||event.button!==0)return;
    const target=event.target as HTMLElement|null;
    if(target?.closest('button,a,input,select,textarea,[role="button"]'))return;
    stage=card.closest<HTMLElement>('.home-map-stage');if(!stage)return;
    const rect=card.getBoundingClientRect();offsetX=event.clientX-rect.left;offsetY=event.clientY-rect.top;dragging=true;card.classList.add('home-promo-dragging');event.preventDefault();
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',stop,{once:true});window.addEventListener('pointercancel',stop,{once:true});
  });
}

export default function HomeMapUiCleanup(){
  useLayoutEffect(()=>{
    let browseInitialized=false,promoInitialized=false;
    const initializeBrowsePanel=()=>{
      if(browseInitialized)return;
      const panel=document.querySelector<HTMLElement>('.map-first-home .map-browser-panel');if(!panel)return;
      panel.querySelector<HTMLButtonElement>('.map-browser-panel-head button')?.click();browseInitialized=true;document.body.classList.add('geoweedo-home-browse-ready');
    };
    const initializePromo=()=>{
      if(promoInitialized)return;
      const card=document.querySelector<HTMLElement>('.map-first-home .home-play-card-promo');if(card){promoInitialized=true;return;}
      const collapsed=document.querySelector<HTMLButtonElement>('.map-first-home button[aria-label="Show game intro"]');if(!collapsed)return;promoInitialized=true;collapsed.click();
    };
    const bind=()=>{
      initializeBrowsePanel();initializePromo();
      const card=document.querySelector<HTMLElement>('.map-first-home .home-play-card-promo');if(card){bindSearchAction(card);bindPromoDrag(card);}
      const mapSearch=document.querySelector<HTMLInputElement>('.map-first-home .map-browser-tools input');if(mapSearch)bindMapSearch(mapSearch);
    };
    bind();const observer=new MutationObserver(bind);observer.observe(document.body,{subtree:true,childList:true});
    const fallback=window.setTimeout(()=>document.body.classList.add('geoweedo-home-browse-ready'),600);
    return()=>{observer.disconnect();window.clearTimeout(fallback);document.body.classList.remove('geoweedo-home-browse-ready');};
  },[]);
  return null;
}
