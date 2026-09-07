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
   new Marker({color:'#67d66e',scale:.72}).setLngLat([longitude,latitude]).addTo(map);
   map.resize();
  });
  return()=>map.remove();
 },[latitude,longitude]);
 return <div ref={nodeRef} className={className} aria-hidden="true"/>;
}
