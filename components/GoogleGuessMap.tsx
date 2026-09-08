'use client';

import {useEffect,useRef,useState} from 'react';
import type {LatLng} from '@/components/GuessMapLegacy';

type Props={guess:LatLng|null;actual?:LatLng|null;revealed?:boolean;onGuess:(guess:LatLng)=>void;onUnavailable?:()=>void};

declare global{interface Window{google?:any;__geoWeedoGoogleMapsPromise?:Promise<any>;}}

function randomGameplayViewport(){const regions=[{west:-124.5,east:-116,south:42,north:49},{west:-122,east:-108,south:32,north:41},{west:-113,east:-101,south:37,north:47},{west:-103,east:-86,south:36,north:48},{west:-100,east:-81,south:29,north:37},{west:-83,east:-69,south:39,north:47},{west:-90,east:-76,south:25,north:35}],r=regions[Math.floor(Math.random()*regions.length)];return{center:{lat:r.south+Math.random()*(r.north-r.south),lng:r.west+Math.random()*(r.east-r.west)},zoom:4};}

async function loadGoogleMaps(){
 if(window.google?.maps?.Map)return window.google;
 if(window.__geoWeedoGoogleMapsPromise)return window.__geoWeedoGoogleMapsPromise;
 window.__geoWeedoGoogleMapsPromise=(async()=>{
  const response=await fetch('/api/street-imagery/google-config',{cache:'no-store'});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.apiKey)throw new Error(data?.error||'Google Maps browser configuration is unavailable.');
  await new Promise<void>((resolve,reject)=>{
   const existing=document.querySelector<HTMLScriptElement>('script[data-geoweedo-google-maps]');
   if(existing){if(window.google?.maps?.Map){resolve();return;}existing.addEventListener('load',()=>resolve(),{once:true});existing.addEventListener('error',()=>reject(new Error('Google Maps JavaScript failed to load.')),{once:true});return;}
   const script=document.createElement('script');script.dataset.geoweedoGoogleMaps='1';script.async=true;script.defer=true;script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(String(data.apiKey))}&v=weekly`;script.onload=()=>resolve();script.onerror=()=>reject(new Error('Google Maps JavaScript failed to load.'));document.head.appendChild(script);
  });
  if(!window.google?.maps?.Map)throw new Error('Google Maps did not initialize.');
  return window.google;
 })().catch(error=>{window.__geoWeedoGoogleMapsPromise=undefined;throw error;});
 return window.__geoWeedoGoogleMapsPromise;
}

export default function GoogleGuessMap({guess,actual=null,revealed=false,onGuess,onUnavailable}:Props){
 const nodeRef=useRef<HTMLDivElement|null>(null),mapRef=useRef<any>(null),guessMarkerRef=useRef<any>(null),actualMarkerRef=useRef<any>(null),lineRef=useRef<any>(null),onGuessRef=useRef(onGuess);
 const[error,setError]=useState<string|null>(null);
 useEffect(()=>{onGuessRef.current=onGuess;},[onGuess]);
 useEffect(()=>{if(!nodeRef.current||mapRef.current)return;let cancelled=false;loadGoogleMaps().then(google=>{if(cancelled||!nodeRef.current)return;const initial=randomGameplayViewport();const map=new google.maps.Map(nodeRef.current,{center:initial.center,zoom:initial.zoom,mapTypeId:'roadmap',gestureHandling:'greedy',streetViewControl:false,mapTypeControl:false,fullscreenControl:false,zoomControl:true,clickableIcons:false,keyboardShortcuts:true});mapRef.current=map;map.addListener('click',(event:any)=>{if(!event.latLng||revealed)return;onGuessRef.current({lat:event.latLng.lat(),lng:event.latLng.lng()});});}).catch(e=>{if(cancelled)return;setError(e instanceof Error?e.message:'Google guess map failed to load.');onUnavailable?.();});return()=>{cancelled=true;const google=window.google;if(mapRef.current&&google?.maps?.event)google.maps.event.clearInstanceListeners(mapRef.current);mapRef.current=null;};},[]);
 useEffect(()=>{const google=window.google,map=mapRef.current;if(!google?.maps||!map)return;if(guessMarkerRef.current){guessMarkerRef.current.setMap(null);guessMarkerRef.current=null;}if(!guess)return;const marker=new google.maps.Marker({map,position:guess,title:'Your guess',draggable:!revealed,icon:{path:google.maps.SymbolPath.CIRCLE,scale:8,fillColor:'#67d66e',fillOpacity:1,strokeColor:'#071108',strokeWeight:3}});if(!revealed)marker.addListener('dragend',(event:any)=>{if(event.latLng)onGuessRef.current({lat:event.latLng.lat(),lng:event.latLng.lng()});});guessMarkerRef.current=marker;},[guess,revealed]);
 useEffect(()=>{const google=window.google,map=mapRef.current;if(!google?.maps||!map)return;if(actualMarkerRef.current){actualMarkerRef.current.setMap(null);actualMarkerRef.current=null;}if(lineRef.current){lineRef.current.setMap(null);lineRef.current=null;}if(!revealed||!actual)return;actualMarkerRef.current=new google.maps.Marker({map,position:actual,title:'Actual location'});if(guess){lineRef.current=new google.maps.Polyline({map,path:[guess,actual],geodesic:true,strokeColor:'#67d66e',strokeOpacity:.9,strokeWeight:3});const bounds=new google.maps.LatLngBounds();bounds.extend(guess);bounds.extend(actual);map.fitBounds(bounds,42);}},[actual,guess,revealed]);
 return <div className="guess-map-wrap google-guess-map-wrap"><div ref={nodeRef} className="guess-map-canvas google-guess-map-canvas" tabIndex={0}/>{error&&<div className="map-data-warning">Google guess map unavailable: {error}</div>}{!revealed&&<div className="map-hint">Drag to pan · scroll/pinch to zoom · click to place your guess</div>}</div>;
}
