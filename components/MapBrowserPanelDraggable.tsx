'use client';

import { useEffect } from 'react';

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
    const decorate=()=>{ decorateSelectedCard(); };

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
    const pinPanelBeforeToggle=(event:MouseEvent)=>{
      if(window.innerWidth<=650)return;
      const target=event.target as HTMLElement|null;
      if(!target?.closest('.map-browser-state-head'))return;
      const panel=target.closest<HTMLElement>('.map-first-home .map-browser-panel');
      const stage=panel?.closest<HTMLElement>('.home-map-stage');
      if(!panel||!stage)return;
      const panelRect=panel.getBoundingClientRect(),stageRect=stage.getBoundingClientRect();
      panel.style.setProperty('left',`${panelRect.left-stageRect.left}px`,'important');
      panel.style.setProperty('top',`${panelRect.top-stageRect.top}px`,'important');
      panel.style.setProperty('right','auto','important');
      panel.style.setProperty('bottom','auto','important');
      panel.style.setProperty('transform','none','important');
      panel.classList.add('map-browser-panel-user-positioned');
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


    document.addEventListener('pointerdown',onPointerDown);
    document.addEventListener('click',pinPanelBeforeToggle,{capture:true});
    const observer=new MutationObserver(decorate);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-location-id','data-location-kind']});
    decorate();

    return()=>{
      document.removeEventListener('pointerdown',onPointerDown);
      document.removeEventListener('click',pinPanelBeforeToggle,{capture:true});
      stopDrag();
      observer.disconnect();
    };
  },[]);
  return null;
}
