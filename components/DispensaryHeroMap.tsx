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
 el.style.width='48px';
 el.style.height='58px';
 el.style.position='relative';
 el.style.filter='drop-shadow(0 4px 6px rgba(0,0,0,.55))';
 el.innerHTML=`<div style="width:46px;height:46px;border-radius:50% 50% 50% 8px;transform:rotate(-45deg);background:#42cf59;border:2px solid rgba(238,255,240,.95);display:grid;place-items:center;box-shadow:0 0 0 3px rgba(7,17,8,.35)"><div style="width:35px;height:35px;border-radius:50%;overflow:hidden;background:#071108;display:grid;place-items:center"><img src="/assets/geoweedo/geoweedo-icon-master.png" alt="" style="width:34px;height:34px;object-fit:contain;transform:rotate(45deg)" /></div></div>`;
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
   zoom:13.6,
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
