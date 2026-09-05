'use client';

import { useEffect } from 'react';

export default function MapBrowserPanelDraggable(){
  useEffect(()=>{
    let cleanup:(()=>void)|null=null;
    const attach=()=>{
      cleanup?.();cleanup=null;
      const panel=document.querySelector<HTMLElement>('.map-first-home .map-browser-panel');
      if(!panel)return;
      panel.classList.add('map-browser-panel-draggable');
      const handle=panel.querySelector<HTMLElement>('.map-browser-panel-head');
      if(!handle)return;
      let dragging=false,startX=0,startY=0,startLeft=0,startTop=0;
      const down=(event:PointerEvent)=>{
        if(event.button!==0||(event.target as HTMLElement).closest('button,a,input,select'))return;
        const rect=panel.getBoundingClientRect();
        dragging=true;startX=event.clientX;startY=event.clientY;startLeft=rect.left;startTop=rect.top;
        panel.classList.add('map-browser-panel-dragging');
        panel.style.left=`${rect.left}px`;panel.style.top=`${rect.top}px`;panel.style.right='auto';panel.style.transform='none';
        handle.setPointerCapture?.(event.pointerId);event.preventDefault();
      };
      const move=(event:PointerEvent)=>{
        if(!dragging)return;
        const maxLeft=Math.max(8,window.innerWidth-panel.offsetWidth-8),maxTop=Math.max(8,window.innerHeight-panel.offsetHeight-8);
        panel.style.left=`${Math.min(maxLeft,Math.max(8,startLeft+event.clientX-startX))}px`;
        panel.style.top=`${Math.min(maxTop,Math.max(8,startTop+event.clientY-startY))}px`;
      };
      const up=()=>{if(!dragging)return;dragging=false;panel.classList.remove('map-browser-panel-dragging');};
      const expand=(event:MouseEvent)=>{
        if((event.target as HTMLElement).closest('button,a,input,select'))return;
        if(panel.classList.contains('map-browser-panel-search-minimized'))panel.classList.remove('map-browser-panel-search-minimized');
      };
      handle.addEventListener('pointerdown',down);handle.addEventListener('click',expand);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
      cleanup=()=>{handle.removeEventListener('pointerdown',down);handle.removeEventListener('click',expand);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};
    };
    attach();
    const observer=new MutationObserver(()=>attach());observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();cleanup?.();};
  },[]);
  return null;
}
