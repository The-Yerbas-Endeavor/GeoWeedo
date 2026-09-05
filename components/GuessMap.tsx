'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import StreetViewStage from '@/components/StreetViewStage';
import { LngLatBounds, Map as LibreMap, Marker, NavigationControl, Popup, type StyleSpecification } from 'maplibre-gl';

export type LatLng = { lat: number; lng: number };
export type MapLocation = { id:string; name:string; lat:number; lng:number; city?:string; region?:string; sponsored?:boolean; approved?:boolean; imageryReady?:boolean; source?:string };
type Props = { guess:LatLng|null; actual?:LatLng|null; revealed?:boolean; onGuess:(guess:LatLng)=>void; locations?:MapLocation[]; browseMode?:boolean };
type BaseMap = 'street'|'topo'|'satellite';

const MAX_RENDERED_ROWS_PER_STATE = 180;
const SEARCH_DEBOUNCE_MS = 260;
const MIN_SEARCH_CHARS = 2;
const MAX_AUTO_FIT_RESULTS = 250;
const PIN_BATCH_SIZE = 140;

const BASE_MAPS:Record<BaseMap,{source:string;layer:string;tiles:string[];attribution:string;maxzoom:number}> = {
  street:{source:'geoweedo-base-street-source',layer:'geoweedo-base-street-layer',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],attribution:'© OpenStreetMap contributors',maxzoom:19},
  topo:{source:'geoweedo-base-topo-source',layer:'geoweedo-base-topo-layer',tiles:['https://tile.opentopomap.org/{z}/{x}/{y}.png'],attribution:'© OpenTopoMap contributors',maxzoom:17},
  satellite:{source:'geoweedo-base-satellite-source',layer:'geoweedo-base-satellite-layer',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],attribution:'Tiles © Esri',maxzoom:19},
};

const GAME_STYLE:StyleSpecification = {version:8,sources:{
  [BASE_MAPS.street.source]:{type:'raster',tiles:BASE_MAPS.street.tiles,tileSize:256,attribution:BASE_MAPS.street.attribution,maxzoom:BASE_MAPS.street.maxzoom},
  [BASE_MAPS.topo.source]:{type:'raster',tiles:BASE_MAPS.topo.tiles,tileSize:256,attribution:BASE_MAPS.topo.attribution,maxzoom:BASE_MAPS.topo.maxzoom},
  [BASE_MAPS.satellite.source]:{type:'raster',tiles:BASE_MAPS.satellite.tiles,tileSize:256,attribution:BASE_MAPS.satellite.attribution,maxzoom:BASE_MAPS.satellite.maxzoom},
},layers:[
  {id:BASE_MAPS.street.layer,type:'raster',source:BASE_MAPS.street.source,minzoom:0,layout:{visibility:'visible'}},
  {id:BASE_MAPS.topo.layer,type:'raster',source:BASE_MAPS.topo.source,minzoom:0,layout:{visibility:'none'}},
  {id:BASE_MAPS.satellite.layer,type:'raster',source:BASE_MAPS.satellite.source,minzoom:0,layout:{visibility:'none'}},
]};

const USA_HOME_VIEW={center:[-98.5,39.0] as [number,number],zoom:3.3};

function validLocation(location:MapLocation){return Number.isFinite(location.lat)&&Number.isFinite(location.lng)&&location.lat>=-90&&location.lat<=90&&location.lng>=-180&&location.lng<=180;}
function locationIdentity(location:MapLocation){return `${location.id}|${Number(location.lat).toFixed(6)}|${Number(location.lng).toFixed(6)}`;}
function fitLocations(map:LibreMap,locations:MapLocation[],maxZoom=5.5){const good=locations.filter(validLocation);if(!good.length)return;const bounds=new LngLatBounds();for(const item of good)bounds.extend([item.lng,item.lat]);if(!bounds.isEmpty())map.fitBounds(bounds,{padding:70,maxZoom,duration:500});}
function categoryVisible(item:MapLocation,showPlayable:boolean,showBrowse:boolean,showSponsored:boolean){if(item.sponsored)return showSponsored;if(item.approved&&item.imageryReady)return showPlayable;return showBrowse;}
function isPlayable(item:MapLocation){return Boolean(item.approved&&item.imageryReady);}
function isListed(item:MapLocation){return item.source==='GeoWeedo approved'||Boolean(item.sponsored);}
function markerColor(item:MapLocation){if(item.sponsored)return '#f5c451';if(item.approved&&item.imageryReady)return '#67d66e';return '#b6c2b8';}
function markerPriority(item:MapLocation){if(item.sponsored)return 3;if(item.approved&&item.imageryReady)return 2;return 1;}
function markerZIndex(item:MapLocation){return String(5+markerPriority(item));}
function markerScale(item:MapLocation){if(item.sponsored)return 0.92;if(item.approved&&item.imageryReady)return 0.82;return 0.68;}
function raiseMarker(marker:Marker,z='6'){const el=marker.getElement();el.style.zIndex=z;el.style.pointerEvents='auto';return el;}
function switchBaseMap(map:LibreMap,baseMap:BaseMap){for(const [name,config] of Object.entries(BASE_MAPS) as [BaseMap,(typeof BASE_MAPS)[BaseMap]][]){if(map.getLayer(config.layer))map.setLayoutProperty(config.layer,'visibility',name===baseMap?'visible':'none');}map.triggerRepaint();}
function randomGameplayViewport(){const regions=[{west:-124.5,east:-116,south:42,north:49},{west:-122,east:-108,south:32,north:41},{west:-113,east:-101,south:37,north:47},{west:-103,east:-86,south:36,north:48},{west:-100,east:-81,south:29,north:37},{west:-83,east:-69,south:39,north:47},{west:-90,east:-76,south:25,north:35}];const region=regions[Math.floor(Math.random()*regions.length)];return{center:[region.west+Math.random()*(region.east-region.west),region.south+Math.random()*(region.north-region.south)] as [number,number],zoom:3.2+Math.random()*1.15};}

export default function GuessMap({guess,actual=null,revealed=false,onGuess,locations=[],browseMode=false}:Props){
  const nodeRef=useRef<HTMLDivElement|null>(null),mapRef=useRef<LibreMap|null>(null),guessMarkerRef=useRef<Marker|null>(null),actualMarkerRef=useRef<Marker|null>(null),userMarkerRef=useRef<Marker|null>(null),selectedMarkerRef=useRef<Marker|null>(null),baseMapRef=useRef<BaseMap>('street'),browseMarkerRefs=useRef<Map<string,Marker>>(new Map()),pinBatchTimerRef=useRef<number|undefined>(undefined);
  const revealedRef=useRef(revealed),previousRevealedRef=useRef(revealed),browseModeRef=useRef(browseMode),onGuessRef=useRef(onGuess),deepLinkFocusRef=useRef(false);
  const [browseLoadedCount,setBrowseLoadedCount]=useState(0),[mapWarning,setMapWarning]=useState<string|null>(null),[mapReady,setMapReady]=useState(false),[searchInput,setSearchInput]=useState(''),[searchQuery,setSearchQuery]=useState(''),[region,setRegion]=useState('all'),[locating,setLocating]=useState(false),[selectedLocation,setSelectedLocation]=useState<MapLocation|null>(null),[browserOpen,setBrowserOpen]=useState(true),[streetViewOpen,setStreetViewOpen]=useState(false),[expandedStates,setExpandedStates]=useState<Record<string,boolean>>({__play:true,__listed:false,__all:true}),[layersOpen,setLayersOpen]=useState(false),[baseMap,setBaseMap]=useState<BaseMap>('street'),[showPlayable,setShowPlayable]=useState(true),[showBrowse,setShowBrowse]=useState(true),[showSponsored,setShowSponsored]=useState(true);

  const normalizedSearch=searchQuery.trim().toLowerCase();
  const activeSearch=normalizedSearch.length>=MIN_SEARCH_CHARS?normalizedSearch:'';
  const regions=useMemo(()=>Array.from(new Set(locations.map(i=>i.region).filter((v):v is string=>Boolean(v)))).sort((a,b)=>a.localeCompare(b)),[locations]);
  const filteredLocations=useMemo(()=>locations.filter(i=>categoryVisible(i,showPlayable,showBrowse,showSponsored)&&(region==='all'||i.region===region)&&(!activeSearch||`${i.name} ${i.city||''} ${i.region||''}`.toLowerCase().includes(activeSearch))),[locations,region,activeSearch,showPlayable,showBrowse,showSponsored]);
  const browseList=useMemo(()=>Array.from(filteredLocations).sort((a,b)=>(a.region||'').localeCompare(b.region||'')||(a.city||'').localeCompare(b.city||'')||a.name.localeCompare(b.name)),[filteredLocations]);
  const playList=useMemo(()=>browseList.filter(isPlayable),[browseList]);
  const listedList=useMemo(()=>browseList.filter(isListed),[browseList]);
  const stateGroups=useMemo(()=>{const groups=new Map<string,MapLocation[]>();for(const item of browseList){const state=(item.region||'Unknown state').trim()||'Unknown state';const group=groups.get(state);if(group)group.push(item);else groups.set(state,[item]);}return Array.from(groups.entries()).map(([state,items])=>({state,items}));},[browseList]);

  useEffect(()=>{const timer=window.setTimeout(()=>setSearchQuery(searchInput),SEARCH_DEBOUNCE_MS);return()=>window.clearTimeout(timer);},[searchInput]);
  useEffect(()=>{revealedRef.current=revealed;},[revealed]);
  useEffect(()=>{browseModeRef.current=browseMode;},[browseMode]);
  useEffect(()=>{onGuessRef.current=onGuess;},[onGuess]);
  useEffect(()=>{baseMapRef.current=baseMap;const map=mapRef.current;if(map)switchBaseMap(map,baseMap);},[baseMap]);

  const showSelectedMarker=(item:MapLocation)=>{const map=mapRef.current;if(!map)return;selectedMarkerRef.current?.remove();const marker=new Marker({color:'#67d66e',scale:1.25}).setLngLat([item.lng,item.lat]).setPopup(new Popup({offset:24,closeButton:false}).setText(item.name)).addTo(map);raiseMarker(marker,'9');selectedMarkerRef.current=marker;};
  const focusLocation=(item:MapLocation,zoom=14)=>{setSelectedLocation(item);setBrowserOpen(true);setStreetViewOpen(true);showSelectedMarker(item);const map=mapRef.current;if(map)map.easeTo({center:[item.lng,item.lat],zoom:Math.max(map.getZoom(),zoom),duration:350});};
  const toggleState=(state:string,items:MapLocation[])=>{setExpandedStates(current=>({...current,[state]:!current[state]}));const map=mapRef.current;if(map&&items.length<=MAX_AUTO_FIT_RESULTS)fitLocations(map,items,10);};
  const togglePriority=(key:'__play'|'__listed'|'__all',items:MapLocation[])=>{setExpandedStates(current=>({...current,[key]:!current[key]}));const map=mapRef.current;if(map&&items.length>0&&items.length<=MAX_AUTO_FIT_RESULTS)fitLocations(map,items,9);};
  const renderRows=(items:MapLocation[],status:'PLAY'|'LISTED')=>{const visible=items.slice(0,MAX_RENDERED_ROWS_PER_STATE);return <div className="map-browser-state-list">{visible.map(item=><button key={`${status}-${locationIdentity(item)}`} type="button" className="map-browser-row" onClick={()=>focusLocation(item)}><span className="map-browser-row-pin">●</span><span className="map-browser-row-copy"><strong>{item.name}</strong><small>{item.city||item.region||'Location'}</small></span><span className="map-browser-row-status">{status}</span></button>)}{items.length>visible.length&&<div className="map-browser-empty">Showing first {visible.length.toLocaleString()} of {items.length.toLocaleString()} results. Refine your search to narrow the list.</div>}</div>;};

  useEffect(()=>{
    if(!browseMode)return;
    const identifier=new URLSearchParams(window.location.search).get('location');
    if(!identifier)return;
    let active=true;
    const close=document.querySelector<HTMLButtonElement>('.home-play-card button[aria-label="Close game intro"]');
    close?.click();
    fetch(`/api/dispensary-resolve/${encodeURIComponent(identifier)}`,{cache:'no-store'})
      .then(async response=>{if(!response.ok)throw new Error('Location not found.');return response.json();})
      .then(data=>{
        if(!active)return;
        const l=data?.location;
        const item:MapLocation={id:String(l?.id||data?.locationId||''),name:String(l?.name||'Dispensary'),lat:Number(l?.latitude),lng:Number(l?.longitude),city:String(l?.city||''),region:String(l?.region||''),approved:Boolean(l?.approved),imageryReady:Boolean(l?.imageryReady),source:String(l?.source||'GeoWeedo')};
        if(!item.id||!validLocation(item))return;
        deepLinkFocusRef.current=true;
        setSelectedLocation(item);
        setBrowserOpen(true);
        setStreetViewOpen(true);
      })
      .catch(()=>{});
    return()=>{active=false;};
  },[browseMode]);

  useEffect(()=>{if(!nodeRef.current||mapRef.current)return;try{const initial=browseMode?USA_HOME_VIEW:randomGameplayViewport();const map=new LibreMap({container:nodeRef.current,style:GAME_STYLE,center:initial.center,zoom:initial.zoom,minZoom:1,maxZoom:19,attributionControl:{},dragRotate:false,pitchWithRotate:false,scrollZoom:true,dragPan:true,doubleClickZoom:true,keyboard:true,touchZoomRotate:true,boxZoom:true});mapRef.current=map;map.touchZoomRotate.disableRotation();map.addControl(new NavigationControl({showCompass:false,visualizePitch:false}),'top-right');map.on('load',()=>{map.resize();switchBaseMap(map,baseMapRef.current);setMapWarning(null);setMapReady(true);});map.on('click',e=>{if(browseModeRef.current||revealedRef.current)return;onGuessRef.current({lat:e.lngLat.lat,lng:e.lngLat.lng});});map.on('error',e=>{const m=e.error?.message||'Map resource failed to load.';console.warn('GeoWeedo map resource warning:',m);if(!/tile/i.test(m))setMapWarning(m);});const timer=window.setTimeout(()=>{map.resize();switchBaseMap(map,baseMapRef.current);if(map.loaded())setMapReady(true);},250);return()=>{window.clearTimeout(timer);window.clearTimeout(pinBatchTimerRef.current);setMapReady(false);userMarkerRef.current?.remove();selectedMarkerRef.current?.remove();browseMarkerRefs.current.forEach(marker=>marker.remove());browseMarkerRefs.current.clear();map.remove();mapRef.current=null;};}catch(error){setMapWarning(error instanceof Error?error.message:'Map initialization failed.');}},[]);

  useEffect(()=>{
    if(!browseMode||!mapReady||!selectedLocation||!deepLinkFocusRef.current)return;
    const map=mapRef.current;if(!map)return;
    deepLinkFocusRef.current=false;
    showSelectedMarker(selectedLocation);
    map.jumpTo({center:[selectedLocation.lng,selectedLocation.lat],zoom:15});
    window.history.replaceState({},'',window.location.pathname);
  },[browseMode,mapReady,selectedLocation]);

  useEffect(()=>{const wasRevealed=previousRevealedRef.current;previousRevealedRef.current=revealed;if(browseMode||!wasRevealed||revealed||guess!==null)return;const map=mapRef.current;if(!map)return;const viewport=randomGameplayViewport();map.jumpTo({center:viewport.center,zoom:viewport.zoom});},[browseMode,guess,revealed]);

  useEffect(()=>{
    const map=mapRef.current;if(!map||!browseMode||!mapReady)return;
    const markers=browseMarkerRefs.current;
    let cancelled=false;
    window.clearTimeout(pinBatchTimerRef.current);
    const visible=filteredLocations.filter(validLocation).sort((a,b)=>markerPriority(b)-markerPriority(a));
    const wanted=new Set(visible.map(locationIdentity));
    markers.forEach((marker,identity)=>{if(!wanted.has(identity)){marker.remove();markers.delete(identity);}});
    const pending=visible.filter(item=>!markers.has(locationIdentity(item)));
    let index=0;

    const addMarker=(item:MapLocation)=>{
      const identity=locationIdentity(item);if(markers.has(identity)||cancelled)return;
      const marker=new Marker({color:markerColor(item),scale:markerScale(item)}).setLngLat([item.lng,item.lat]).setPopup(new Popup({offset:20,closeButton:false}).setText(item.name));
      const el=raiseMarker(marker,markerZIndex(item));el.title=[item.name,item.city,item.region].filter(Boolean).join(' · ');el.style.cursor='pointer';el.dataset.locationIdentity=identity;el.dataset.pinPriority=item.sponsored?'sponsored':item.approved&&item.imageryReady?'gameplay':'browse';
      el.addEventListener('click',event=>{event.stopPropagation();setSelectedLocation(item);setBrowserOpen(true);setStreetViewOpen(true);showSelectedMarker(item);});
      marker.addTo(map);raiseMarker(marker,markerZIndex(item));markers.set(identity,marker);
    };

    const renderBatch=()=>{
      if(cancelled)return;
      const end=Math.min(index+PIN_BATCH_SIZE,pending.length);
      for(;index<end;index++)addMarker(pending[index]);
      setBrowseLoadedCount(markers.size);
      window.dispatchEvent(new CustomEvent('geoweedo:pins-progress',{detail:{loaded:markers.size,total:visible.length}}));
      if(index<pending.length)pinBatchTimerRef.current=window.setTimeout(renderBatch,0);
    };

    if(pending.length)renderBatch();else setBrowseLoadedCount(markers.size);
    return()=>{cancelled=true;window.clearTimeout(pinBatchTimerRef.current);};
  },[browseMode,filteredLocations,mapReady]);

  useEffect(()=>{const map=mapRef.current;if(!map||!browseMode||!mapReady)return;const shouldFitSearch=activeSearch.length>=MIN_SEARCH_CHARS&&filteredLocations.length>0&&filteredLocations.length<=MAX_AUTO_FIT_RESULTS;const shouldFitRegion=region!=='all'&&filteredLocations.length>0&&filteredLocations.length<=MAX_AUTO_FIT_RESULTS;if(shouldFitSearch||shouldFitRegion)fitLocations(map,filteredLocations,9);},[browseMode,filteredLocations,region,activeSearch,mapReady]);

  useEffect(()=>{const map=mapRef.current;if(!map)return;guessMarkerRef.current?.remove();actualMarkerRef.current?.remove();if(map.getLayer('guess-line'))map.removeLayer('guess-line');if(map.getSource('guess-line'))map.removeSource('guess-line');if(guess){const marker=new Marker({color:'#67d66e'}).setLngLat([guess.lng,guess.lat]).addTo(map);raiseMarker(marker,'9');guessMarkerRef.current=marker;}if(revealed&&actual){const marker=new Marker({color:'#f4f7f4'}).setLngLat([actual.lng,actual.lat]).addTo(map);raiseMarker(marker,'9');actualMarkerRef.current=marker;if(guess){const bounds=new LngLatBounds();bounds.extend([guess.lng,guess.lat]);bounds.extend([actual.lng,actual.lat]);map.fitBounds(bounds,{padding:48,maxZoom:10,duration:500});}}},[guess,actual,revealed]);

  const locateMe=()=>{if(!navigator.geolocation){setMapWarning('Location services are not available in this browser.');return;}setLocating(true);navigator.geolocation.getCurrentPosition(p=>{setLocating(false);const map=mapRef.current;if(!map)return;const lng=p.coords.longitude,lat=p.coords.latitude;userMarkerRef.current?.remove();const marker=new Marker({color:'#fff'}).setLngLat([lng,lat]).setPopup(new Popup({offset:14}).setText('You are here')).addTo(map);raiseMarker(marker,'9');userMarkerRef.current=marker;map.easeTo({center:[lng,lat],zoom:11,duration:700});},e=>{setLocating(false);setMapWarning(e.message||'Could not determine your location.');},{timeout:8000,maximumAge:300000});};
  const openStreetView=()=>{if(!selectedLocation)return;showSelectedMarker(selectedLocation);mapRef.current?.easeTo({center:[selectedLocation.lng,selectedLocation.lat],zoom:16,duration:350});setStreetViewOpen(true);};
  const baseMapLabel=baseMap==='street'?'Street':baseMap==='topo'?'Topographic':'Satellite';
  const searchActive=activeSearch.length>=MIN_SEARCH_CHARS;

  return <div className="guess-map-wrap">
    <div ref={nodeRef} className="guess-map-canvas" tabIndex={0}/>
    {browseMode&&<>
      <div className="map-browser-tools">
        <input value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Search dispensary or city" aria-label="Search dispensaries" autoComplete="off"/>
        <select value={region} onChange={e=>setRegion(e.target.value)} aria-label="Filter by state"><option value="all">All states</option>{regions.map(v=><option key={v} value={v}>{v}</option>)}</select>
        <button type="button" onClick={locateMe} disabled={locating}>{locating?'Locating…':'Near me'}</button>
        <button type="button" onClick={()=>setLayersOpen(v=>!v)} aria-expanded={layersOpen}>Layers · {baseMapLabel}</button>
        <button type="button" onClick={()=>setBrowserOpen(o=>!o)}>{browserOpen?'Hide list':`List (${browseList.length})`}</button>
      </div>
      {layersOpen&&<aside className="map-layers-panel"><div className="map-layers-head"><strong>MAP LAYERS</strong><button type="button" onClick={()=>setLayersOpen(false)}>×</button></div><div className="map-layers-section"><span>Base map</span><label><input type="radio" name="base-map" checked={baseMap==='street'} onChange={()=>setBaseMap('street')}/> Street {baseMap==='street'?'✓':''}</label><label><input type="radio" name="base-map" checked={baseMap==='topo'} onChange={()=>setBaseMap('topo')}/> Topographic {baseMap==='topo'?'✓':''}</label><label><input type="radio" name="base-map" checked={baseMap==='satellite'} onChange={()=>setBaseMap('satellite')}/> Satellite {baseMap==='satellite'?'✓':''}</label></div><div className="map-layers-section"><span>Dispensaries</span><label><input type="checkbox" checked={showPlayable} onChange={e=>setShowPlayable(e.target.checked)}/><i className="layer-dot playable"/> Playable</label><label><input type="checkbox" checked={showBrowse} onChange={e=>setShowBrowse(e.target.checked)}/><i className="layer-dot browse"/> Browse only</label><label><input type="checkbox" checked={showSponsored} onChange={e=>setShowSponsored(e.target.checked)}/><i className="layer-dot sponsored"/> Sponsored</label></div></aside>}
    </>}
    {browseMode&&browserOpen&&!selectedLocation&&<aside className="map-browser-panel" aria-label="Browse dispensaries"><div className="map-browser-panel-head"><div><span>BROWSE DISPENSARIES</span><strong>{browseList.length.toLocaleString()} mapped locations · {stateGroups.length} states</strong></div><button type="button" onClick={()=>setBrowserOpen(false)}>×</button></div><div className="map-browser-list">{browseList.length===0?<div className="map-browser-empty">No dispensaries match the active filters.</div>:<><section className="map-browser-state map-browser-priority"><button type="button" className="map-browser-state-head" onClick={()=>togglePriority('__play',playList)} aria-expanded={Boolean(expandedStates.__play)}><span><strong>Play</strong><small>{playList.length.toLocaleString()} gameplay-ready locations</small></span><b>{expandedStates.__play?'−':'+'}</b></button>{expandedStates.__play&&renderRows(playList,'PLAY')}</section><section className="map-browser-state map-browser-priority"><button type="button" className="map-browser-state-head" onClick={()=>togglePriority('__listed',listedList)} aria-expanded={Boolean(expandedStates.__listed)}><span><strong>Listed</strong><small>{listedList.length.toLocaleString()} verified public listings</small></span><b>{expandedStates.__listed?'−':'+'}</b></button>{expandedStates.__listed&&renderRows(listedList,'LISTED')}</section><section className="map-browser-state map-browser-all-locations"><button type="button" className="map-browser-state-head" onClick={()=>togglePriority('__all',browseList)} aria-expanded={Boolean(expandedStates.__all)}><span><strong>All Locations</strong><small>{browseList.length.toLocaleString()} mapped locations</small></span><b>{expandedStates.__all?'−':'+'}</b></button>{expandedStates.__all&&<div className="map-browser-all-groups">{stateGroups.map(group=>{const forcedOpen=(searchActive&&browseList.length<=MAX_AUTO_FIT_RESULTS)||region!=='all';const open=forcedOpen||Boolean(expandedStates[group.state]);const visibleItems=group.items.slice(0,MAX_RENDERED_ROWS_PER_STATE);return <section className="map-browser-state" key={group.state}><button type="button" className="map-browser-state-head" onClick={()=>toggleState(group.state,group.items)} aria-expanded={open}><span><strong>{group.state}</strong><small>{group.items.length.toLocaleString()} dispensaries</small></span><b>{open?'−':'+'}</b></button>{open&&<div className="map-browser-state-list">{visibleItems.map(item=><button key={locationIdentity(item)} type="button" className="map-browser-row" onClick={()=>focusLocation(item)}><span className="map-browser-row-pin">●</span><span className="map-browser-row-copy"><strong>{item.name}</strong><small>{item.city||group.state}</small></span><span className="map-browser-row-status">{item.sponsored?'★':item.approved&&item.imageryReady?'PLAY':isListed(item)?'LISTED':'›'}</span></button>)}{group.items.length>visibleItems.length&&<div className="map-browser-empty">Showing first {visibleItems.length.toLocaleString()} of {group.items.length.toLocaleString()} results. Refine your search to narrow the list.</div>}</div>}</section>;})}</div>}</section></>}</div></aside>}
    {browseMode&&selectedLocation&&browserOpen&&<aside className="map-location-card" data-location-id={selectedLocation.id} data-location-lat={selectedLocation.lat} data-location-lng={selectedLocation.lng} data-location-identity={locationIdentity(selectedLocation)}><button className="map-location-close" type="button" onClick={()=>{setSelectedLocation(null);setStreetViewOpen(false);selectedMarkerRef.current?.remove();selectedMarkerRef.current=null;}}>‹</button><div className="map-location-eyebrow">📍 {selectedLocation.sponsored?'FEATURED LOCATION':selectedLocation.approved?'GEOWEEDO LOCATION':'MAP LOCATION'}</div><h3>{selectedLocation.name}</h3><p>{[selectedLocation.city,selectedLocation.region].filter(Boolean).join(', ')||'Location details pending'}</p><div className="map-location-badges">{selectedLocation.approved&&<span>✓ Approved</span>}{selectedLocation.imageryReady&&<span>◉ Imagery ready</span>}{selectedLocation.sponsored&&<span>★ Sponsored</span>}{!selectedLocation.approved&&<span>Browse only</span>}</div><dl><div><dt>Coordinates</dt><dd>{selectedLocation.lat.toFixed(5)}, {selectedLocation.lng.toFixed(5)}</dd></div>{selectedLocation.source&&<div><dt>Source</dt><dd>{selectedLocation.source}</dd></div>}<div><dt>Gameplay</dt><dd>{selectedLocation.approved&&selectedLocation.imageryReady?'Eligible':'Not yet eligible'}</dd></div></dl><button className="map-location-focus" type="button" onClick={openStreetView}>📍 Zoom + Street View</button></aside>}
    {browseMode&&selectedLocation&&streetViewOpen&&<aside className="map-streetview-panel" data-location-id={selectedLocation.id} data-location-identity={locationIdentity(selectedLocation)} aria-label={`Street imagery near ${selectedLocation.name}`}><div className="map-streetview-head"><div><span>STREET IMAGERY</span><strong>{selectedLocation.name}</strong></div><button type="button" onClick={()=>setStreetViewOpen(false)} aria-label="Close street view">×</button></div><div className="map-streetview-stage"><StreetViewStage latitude={selectedLocation.lat} longitude={selectedLocation.lng}/></div></aside>}
    {browseMode&&<div className="map-data-status">{browseLoadedCount.toLocaleString()} loaded · {locations.filter(validLocation).length.toLocaleString()} mapped</div>}
    {mapWarning&&<div className="map-data-warning">Map warning: {mapWarning}</div>}
    {browseMode?<div className="map-hint">Drag to pan · wheel/pinch to zoom · click a pin for location details</div>:!revealed&&<div className="map-hint">Drag to pan · scroll/pinch to zoom · click to place your guess</div>}
  </div>;
}
