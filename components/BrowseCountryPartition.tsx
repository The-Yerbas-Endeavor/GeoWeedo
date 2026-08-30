'use client';

import { useEffect } from 'react';

const EUROPE_REGIONS=new Set(['North Holland']);
const HEADING_CLASS='map-browser-country-heading';

export default function BrowseCountryPartition(){
  useEffect(()=>{
    let applying=false;
    const partition=()=>{
      if(applying)return;
      const list=document.querySelector('.map-browser-list');
      if(!list)return;
      applying=true;
      try{
        list.querySelectorAll(`.${HEADING_CLASS}`).forEach(node=>node.remove());
        const sections=Array.from(list.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node.classList.contains('map-browser-state'));
        if(!sections.length)return;
        const europe=sections.filter(section=>EUROPE_REGIONS.has(section.querySelector('strong')?.textContent?.trim()||''));
        const americas=sections.filter(section=>!europe.includes(section));
        const heading=(label:string,detail:string)=>{const node=document.createElement('div');node.className=HEADING_CLASS;node.setAttribute('aria-label',label);node.style.cssText='padding:11px 12px 7px;border-top:1px solid var(--line);font-size:11px;font-weight:900;letter-spacing:.1em;color:var(--muted);background:rgba(11,14,12,.94)';node.innerHTML=`<span style="color:var(--text)">${label}</span><small style="display:block;margin-top:3px;font-size:10px;font-weight:600;letter-spacing:.03em;color:var(--muted)">${detail}</small>`;return node;};
        if(americas.length){list.insertBefore(heading('AMERICAS','United States dispensaries'),americas[0]);}
        if(europe.length){list.appendChild(heading('EUROPE · AMSTERDAM','Netherlands coffeeshops'));for(const section of europe)list.appendChild(section);}
      }finally{applying=false;}
    };
    const observer=new MutationObserver(()=>queueMicrotask(partition));
    observer.observe(document.body,{childList:true,subtree:true});
    partition();
    return()=>observer.disconnect();
  },[]);
  return null;
}
