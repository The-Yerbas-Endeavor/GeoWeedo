'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map as LibreMap,
  Marker,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type StyleSpecification,
} from 'maplibre-gl';

export type LatLng = { lat: number; lng: number };
export type MapLocation = { id:string; name:string; lat:number; lng:number; city?:string; region?:string; sponsored?:boolean };
type Props = { guess:LatLng|null; actual?:LatLng|null; revealed?:boolean; onGuess:(guess:LatLng)=>void; locations?:MapLocation[]; browseMode?:boolean };

const GAME_STYLE:StyleSpecification={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors',maxzoom:19}},layers:[{id:'osm',type:'raster',source:'osm',minzoom:0,maxzoom:19}]};
const LOCATION_SOURCE='browse-locations',CLUSTER_LAYER='browse-clusters',CLUSTER_COUNT_LAYER='browse-cluster-count',POINT_LAYER='browse-points',LABEL_LAYER='browse-labels';

function featureCoordinates(feature:MapGeoJSONFeature):[number,number]|null{if(feature.geometry.type!=='Point')return null;const c=feature.geometry.coordinates;if(!Array.isArray(c)||c.length<2)return null;const lng=Number(c[0]),lat=Number(c[1]);return Number.isFinite(lat)&&Number.isFinite(lng)?[lng,lat]:null;}
function validLocation(location:MapLocation){return Number.isFinite(location.lat)&&Number.isFinite(location.lng)&&location.lat>=-90&&location.lat<=90&&location.lng>=-180&&location.lng<=180;}
function locationData(locations:MapLocation[]){const features=locations.filter(validLocation).map(location=>({type:'Feature' as const,geometry:{type:'Point' as const,coordinates:[location.lng,location.lat] as [number,number]},properties:{id:location.id,name:location.name,city:location.city||'',region:location.region||'',sponsored:Boolean(location.sponsored)}}));return{type:'FeatureCollection' as const,features};}
function fitLocations(map:LibreMap,locations:MapLocation[],maxZoom=5.5){const good=locations.filter(validLocation);if(!good.length)return;const bounds=new LngLatBounds();for(const item of good)bounds.extend([item.lng,item.lat]);if(!bounds.isEmpty())map.fitBounds(bounds,{padding:70,maxZoom,duration:500});}

export default function GuessMap({guess,actual=null,revealed=false,onGuess,locations=[],browseMode=false}:Props){
 const nodeRef=useRef<HTMLDivElement|null>(null),mapRef=useRef<LibreMap|null>(null),guessMarkerRef=useRef<Marker|null>(null),actualMarkerRef=useRef<Marker|null>(null),userMarkerRef=useRef<Marker|null>(null),hoverPopupRef=useRef<Popup|null>(null);
 const revealedRef=useRef(revealed),browseModeRef=useRef(browseMode),onGuessRef=useRef(onGuess),locationsRef=useRef<MapLocation[]>(locations),fittedBrowseBoundsRef=useRef(false);
 const [browseLoadedCount,setBrowseLoadedCount]=useState(0),[mapWarning,setMapWarning]=useState<string|null>(null),[search,setSearch]=useState(''),[region,setRegion]=useState('all'),[locating,setLocating]=useState(false);
 const regions=useMemo(()=>Array.from(new Set(locations.map(item=>item.region).filter((value):value is string=>Boolean(value)))).sort((a,b)=>a.localeCompare(b)),[locations]);
 const filteredLocations=useMemo(()=>{const q=search.trim().toLowerCase();return locations.filter(item=>{if(region!=='all'&&item.region!==region)return false;if(!q)return true;return `${item.name} ${item.city||''} ${item.region||''}`.toLowerCase().includes(q);});},[locations,region,search]);

 useEffect(()=>{revealedRef.current=revealed;},[revealed]);
 useEffect(()=>{browseModeRef.current=browseMode;},[browseMode]);
 useEffect(()=>{onGuessRef.current=onGuess;},[onGuess]);
 useEffect(()=>{locationsRef.current=filteredLocations;},[filteredLocations]);

 useEffect(()=>{
  if(!nodeRef.current||mapRef.current)return;
  try{
   const map=new LibreMap({container:nodeRef.current,style:GAME_STYLE,center:[-98,39],zoom:2.6,minZoom:1,maxZoom:19,attributionControl:{},dragRotate:false,pitchWithRotate:false,scrollZoom:true,dragPan:true,doubleClickZoom:true,keyboard:true,touchZoomRotate:true,boxZoom:true});
   mapRef.current=map;map.touchZoomRotate.disableRotation();map.addControl(new NavigationControl({showCompass:false,visualizePitch:false}),'top-right');
   const ensureBrowseLayers=()=>{
    if(!browseModeRef.current||!map.isStyleLoaded())return;const data=locationData(locationsRef.current);let source=map.getSource(LOCATION_SOURCE) as GeoJSONSource|undefined;
    if(!source){map.addSource(LOCATION_SOURCE,{type:'geojson',data,cluster:true,clusterMaxZoom:12,clusterRadius:48});source=map.getSource(LOCATION_SOURCE) as GeoJSONSource;}else source.setData(data);
    if(!map.getLayer(CLUSTER_LAYER))map.addLayer({id:CLUSTER_LAYER,type:'circle',source:LOCATION_SOURCE,filter:['has','point_count'],paint:{'circle-color':'#2f8f46','circle-radius':['step',['get','point_count'],18,25,23,100,29,500,35],'circle-stroke-width':2,'circle-stroke-color':'#dff7e2'}});
    if(!map.getLayer(CLUSTER_COUNT_LAYER))map.addLayer({id:CLUSTER_COUNT_LAYER,type:'symbol',source:LOCATION_SOURCE,filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-size':12},paint:{'text-color':'#ffffff'}});
    if(!map.getLayer(POINT_LAYER))map.addLayer({id:POINT_LAYER,type:'circle',source:LOCATION_SOURCE,filter:['!', ['has','point_count']],paint:{'circle-color':['case',['boolean',['get','sponsored'],false],'#f5c451','#67d66e'],'circle-radius':['interpolate',['linear'],['zoom'],5,6,12,8,18,10],'circle-stroke-width':2,'circle-stroke-color':'#102114'}});
    if(!map.getLayer(LABEL_LAYER))map.addLayer({id:LABEL_LAYER,type:'symbol',source:LOCATION_SOURCE,minzoom:10,filter:['!', ['has','point_count']],layout:{'text-field':['get','name'],'text-size':11,'text-offset':[0,1.4],'text-anchor':'top','text-optional':true},paint:{'text-color':'#f4f7f4','text-halo-color':'#102114','text-halo-width':1.5}});
    setBrowseLoadedCount(data.features.length);setMapWarning(null);
    if(data.features.length&&!fittedBrowseBoundsRef.current){fittedBrowseBoundsRef.current=true;fitLocations(map,locationsRef.current);}
   };
   map.on('load',()=>{map.resize();ensureBrowseLayers();});map.on('styledata',ensureBrowseLayers);
   map.on('click',event=>{if(browseModeRef.current||revealedRef.current)return;onGuessRef.current({lat:event.lngLat.lat,lng:event.lngLat.lng});});
   map.on('click',CLUSTER_LAYER,async event=>{const feature=event.features?.[0] as MapGeoJSONFeature|undefined,clusterId=Number(feature?.properties?.cluster_id);if(!feature||!Number.isFinite(clusterId))return;const coordinates=featureCoordinates(feature),source=map.getSource(LOCATION_SOURCE) as GeoJSONSource|undefined;if(!coordinates||!source)return;const zoom=await source.getClusterExpansionZoom(clusterId);map.easeTo({center:coordinates,zoom});});
   map.on('click',POINT_LAYER,event=>{const feature=event.features?.[0] as MapGeoJSONFeature|undefined;if(!feature)return;const coordinates=featureCoordinates(feature);if(!coordinates)return;const p=feature.properties||{},subtitle=[p.city,p.region].filter(Boolean).join(', ');new Popup({offset:12}).setLngLat(coordinates).setHTML(`<strong>${String(p.name||'Dispensary').replace(/[<>&]/g,'')}</strong>${subtitle?`<br><span>${String(subtitle).replace(/[<>&]/g,'')}</span>`:''}`).addTo(map);});
   map.on('mouseenter',POINT_LAYER,event=>{map.getCanvas().style.cursor='pointer';const feature=event.features?.[0] as MapGeoJSONFeature|undefined;if(!feature)return;const coordinates=featureCoordinates(feature);if(!coordinates)return;const p=feature.properties||{},subtitle=[p.city,p.region].filter(Boolean).join(', ');hoverPopupRef.current?.remove();hoverPopupRef.current=new Popup({closeButton:false,closeOnClick:false,offset:10}).setLngLat(coordinates).setText(subtitle?`${p.name} — ${subtitle}`:String(p.name||'Dispensary')).addTo(map);});
   map.on('mouseleave',POINT_LAYER,()=>{map.getCanvas().style.cursor='';hoverPopupRef.current?.remove();hoverPopupRef.current=null;});
   map.on('mouseenter',CLUSTER_LAYER,event=>{map.getCanvas().style.cursor='pointer';const feature=event.features?.[0] as MapGeoJSONFeature|undefined,coordinates=feature?featureCoordinates(feature):null;if(!feature||!coordinates)return;hoverPopupRef.current?.remove();hoverPopupRef.current=new Popup({closeButton:false,closeOnClick:false,offset:12}).setLngLat(coordinates).setText(`${feature.properties?.point_count||''} locations — click to zoom`).addTo(map);});
   map.on('mouseleave',CLUSTER_LAYER,()=>{map.getCanvas().style.cursor='';hoverPopupRef.current?.remove();hoverPopupRef.current=null;});
   map.on('error',event=>{const message=event.error?.message||'Map resource failed to load.';console.warn('GeoWeedo map resource warning:',message);if(!/tile/i.test(message))setMapWarning(message);});
   const resizeTimer=window.setTimeout(()=>{map.resize();ensureBrowseLayers();},250);return()=>{window.clearTimeout(resizeTimer);hoverPopupRef.current?.remove();userMarkerRef.current?.remove();map.remove();mapRef.current=null;};
  }catch(error){const message=error instanceof Error?error.message:'Map initialization failed.';setMapWarning(message);console.error('GeoWeedo map initialization failed:',error);}
 },[]);

 useEffect(()=>{locationsRef.current=filteredLocations;const map=mapRef.current;if(!map||!browseMode)return;const data=locationData(filteredLocations);const apply=()=>{const source=map.getSource(LOCATION_SOURCE) as GeoJSONSource|undefined;if(!source)return;source.setData(data);setBrowseLoadedCount(data.features.length);if(data.features.length)fitLocations(map,filteredLocations,search||region!=='all'?9:5.5);};if(map.isStyleLoaded()&&map.getSource(LOCATION_SOURCE))apply();else map.once('idle',apply);},[browseMode,filteredLocations,region,search]);

 useEffect(()=>{const map=mapRef.current;if(!map)return;guessMarkerRef.current?.remove();guessMarkerRef.current=null;actualMarkerRef.current?.remove();actualMarkerRef.current=null;if(map.getLayer('guess-line'))map.removeLayer('guess-line');if(map.getSource('guess-line'))map.removeSource('guess-line');if(guess)guessMarkerRef.current=new Marker({color:'#67d66e'}).setLngLat([guess.lng,guess.lat]).setPopup(new Popup({offset:18}).setText('Your guess')).addTo(map);if(revealed&&actual){actualMarkerRef.current=new Marker({color:'#f4f7f4'}).setLngLat([actual.lng,actual.lat]).setPopup(new Popup({offset:18}).setText('Actual location')).addTo(map);if(guess){const line={type:'Feature' as const,properties:{},geometry:{type:'LineString' as const,coordinates:[[guess.lng,guess.lat],[actual.lng,actual.lat]]}};const addLine=()=>{if(map.getSource('guess-line'))return;map.addSource('guess-line',{type:'geojson',data:line});map.addLayer({id:'guess-line',type:'line',source:'guess-line',paint:{'line-color':'#67d66e','line-width':3,'line-opacity':.8}});};if(map.isStyleLoaded())addLine();else map.once('load',addLine);const bounds=new LngLatBounds();bounds.extend([guess.lng,guess.lat]);bounds.extend([actual.lng,actual.lat]);map.fitBounds(bounds,{padding:56,maxZoom:9,duration:450});}else map.easeTo({center:[actual.lng,actual.lat],zoom:8,duration:450});}},[guess,actual,revealed]);

 const resetView=()=>{const map=mapRef.current;if(!map)return;setSearch('');setRegion('all');fitLocations(map,locations.length?locations:[{id:'us',name:'USA',lat:39,lng:-98}],5.5);};
 const locateMe=()=>{if(!navigator.geolocation){setMapWarning('Location services are not available in this browser.');return;}setLocating(true);navigator.geolocation.getCurrentPosition(position=>{setLocating(false);const map=mapRef.current;if(!map)return;const lng=position.coords.longitude,lat=position.coords.latitude;userMarkerRef.current?.remove();userMarkerRef.current=new Marker({color:'#ffffff'}).setLngLat([lng,lat]).setPopup(new Popup({offset:14}).setText('You are here')).addTo(map);map.easeTo({center:[lng,lat],zoom:11,duration:700});},error=>{setLocating(false);setMapWarning(error.message||'Could not determine your location.');},{enableHighAccuracy:false,timeout:8000,maximumAge:300000});};

 return <div className="guess-map-wrap">
  <div ref={nodeRef} className="guess-map-canvas" tabIndex={0} aria-label={browseMode?'GeoWeedo dispensary location map':'Interactive open-source guessing map'}/>
  {browseMode&&<div className="map-browser-tools"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search dispensary or city" aria-label="Search map locations"/><select value={region} onChange={e=>setRegion(e.target.value)} aria-label="Filter locations by state"><option value="all">All states</option>{regions.map(value=><option key={value} value={value}>{value}</option>)}</select><button type="button" onClick={locateMe} disabled={locating}>{locating?'Locating…':'Near me'}</button><button type="button" onClick={resetView}>Show all</button></div>}
  {browseMode&&<div className="map-data-status">{browseLoadedCount.toLocaleString()} / {locations.filter(validLocation).length.toLocaleString()} locations</div>}
  {mapWarning&&<div className="map-data-warning">Map warning: {mapWarning}</div>}
  {browseMode?<div className="map-hint">Drag to pan · wheel/pinch to zoom · hover locations · click clusters</div>:!revealed&&<div className="map-hint">Drag to pan · scroll/pinch to zoom · click to place your guess</div>}
 </div>;
}
