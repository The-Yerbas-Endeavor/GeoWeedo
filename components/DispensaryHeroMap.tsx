'use client';

import {useEffect,useRef} from 'react';
import {Map as LibreMap,Marker,type StyleSpecification} from 'maplibre-gl';

type Props={latitude:number;longitude:number;className?:string};

const STYLE:StyleSpecification={
 version:8,
 sources:{
  osm:{
   type:'raster',
   tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
   tileSize:256,
   attribution:'© OpenStreetMap contributors',
   maxzoom:19
  }
 },
 layers:[{id:'osm',type:'raster',source:'osm'}]
};

function brandedPin(){
 const el=document.createElement('div');
 el.setAttribute('aria-hidden','true');
 el.style.width='42px';
 el.style.height='52px';
 el.style.display='grid';
 el.style.placeItems='center';
 el.style.borderRadius='50% 50% 50% 0';
 el.style.transform='rotate(-45deg)';
 el.style.background='#2f9d78';
 el.style.border='2px solid rgba(255,255,255,.9)';
 el.style.boxShadow='0 5px 14px rgba(0,0,0,.45)';
 const leaf=document.createElement('span');
 leaf.textContent='✦';
 leaf.style.transform='rotate(45deg)';
 leaf.style.color='#fff';
 leaf.style.fontSize='19px';
 leaf.style.fontWeight='900';
 leaf.style.lineHeight='1';
 el.appendChild(leaf);
 return el;
}

export default function DispensaryHeroMap({latitude,longitude,className}:Props){
 const nodeRef=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{
  if(!nodeRef.current||!Number.isFinite(latitude)||!Number.isFinite(longitude))return;
  const map=new LibreMap({
   container:nodeRef.current,
   style:STYLE,
   center:[longitude,latitude],
   zoom:10.25,
   interactive:false,
   attributionControl:false,
   fadeDuration:0
  });
  map.once('load',()=>{
   new Marker({element:brandedPin(),anchor:'bottom'}).setLngLat([longitude,latitude]).addTo(map);
   map.resize();
  });
  return()=>map.remove();
 },[latitude,longitude]);
 return <div ref={nodeRef} className={className} aria-hidden="true"/>;
}
