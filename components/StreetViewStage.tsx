'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';

type Props = { latitude:number; longitude:number; heading?:number; photoId?:string; imageryProvider?:'kartaview'|'geoweedo'; imageUrl?:string; projection?:string; fieldOfView?:number };
type StreetPhoto = { id:string; lat:number; lng:number; heading:number; fieldOfView:number; projection:string; imageUrl:string; sequenceId:string; sequenceIndex:number; shotDate?:string|null };
type ApiProvider = 'google'|'kartaview';
type ApiResponse = { provider?:ApiProvider; photos?:StreetPhoto[]; initialIndex?:number; message?:string; error?:string; attribution?:string };

const DEFAULT_FLAT_ZOOM=1.1;
const DEFAULT_FLAT_PAN_Y=0;
const MIN_FLAT_PAN_Y=-34;
const MAX_FLAT_PAN_Y=10;

function distanceMeters(a:{lat:number;lng:number},b:{lat:number;lng:number}){
 const radius=6371008.8,toRad=(v:number)=>v*Math.PI/180,dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng),lat1=toRad(a.lat),lat2=toRad(b.lat);
 const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
 return radius*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

async function readApiResponse(response:Response):Promise<ApiResponse>{
 const text=await response.text();
 if(!text.trim())throw new Error(`Street imagery API returned an empty response (${response.status}).`);
 try{return JSON.parse(text) as ApiResponse;}catch{
  const looksHtml=/^\s*</.test(text);
  throw new Error(looksHtml?`Street imagery API returned an HTML error page (${response.status}). Check the GeoWeedo server log.`:`Street imagery API returned an invalid response (${response.status}).`);
 }
}

export default function StreetViewStage({latitude,longitude,heading=0,photoId,imageryProvider='kartaview',imageUrl,projection='',fieldOfView=0}:Props){
 const rootRef=useRef<HTMLDivElement|null>(null),sphereRef=useRef<HTMLDivElement|null>(null),viewerRef=useRef<Viewer|null>(null);
 const [photos,setPhotos]=useState<StreetPhoto[]>([]),[index,setIndex]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[flatZoom,setFlatZoom]=useState(DEFAULT_FLAT_ZOOM),[flatPanY,setFlatPanY]=useState(DEFAULT_FLAT_PAN_Y),[flatPanning,setFlatPanning]=useState(false),[actualProvider,setActualProvider]=useState<'google'|'kartaview'|'geoweedo'>(imageryProvider==='geoweedo'?'geoweedo':'kartaview'),[attribution,setAttribution]=useState(imageryProvider==='geoweedo'?'GeoWeedo':'KartaView contributors'),[isAdmin,setIsAdmin]=useState(false);
 useEffect(()=>{setIsAdmin(window.location.pathname.startsWith('/admin'));},[]);
 useEffect(()=>{setError(null);setIndex(0);setFlatZoom(DEFAULT_FLAT_ZOOM);setFlatPanY(DEFAULT_FLAT_PAN_Y);if(imageryProvider==='geoweedo'){setActualProvider('geoweedo');setAttribution('GeoWeedo');if(!imageUrl){setPhotos([]);setError('The approved GeoWeedo-hosted image is missing.');setLoading(false);return;}setPhotos([{id:photoId||'geoweedo-hosted',lat:latitude,lng:longitude,heading,fieldOfView,projection:projection.toUpperCase(),imageUrl,sequenceId:'geoweedo',sequenceIndex:0}]);setLoading(false);return;}const c=new AbortController();setLoading(true);setPhotos([]);const q=new URLSearchParams({lat:String(latitude),lng:String(longitude)});if(photoId)q.set('photoId',photoId);fetch(`/api/street-imagery?${q}`,{signal:c.signal,cache:'no-store'}).then(async r=>{const d=await readApiResponse(r);if(!r.ok)throw new Error(d.error||`Street imagery lookup failed (${r.status}).`);return d;}).then(d=>{setActualProvider(d.provider==='google'?'google':'kartaview');setAttribution(d.attribution|| (d.provider==='google'?'Google Street View':'KartaView contributors'));const p=d.photos||[];setPhotos(p);setIndex(Math.min(Math.max(d.initialIndex||0,0),Math.max(0,p.length-1)));if(!p.length)setError(d.message||'No street imagery is available near this location yet.');}).catch(e=>{if(e?.name!=='AbortError')setError(e instanceof Error?e.message:'Street imagery failed to load.');}).finally(()=>setLoading(false));return()=>c.abort();},[latitude,longitude,heading,photoId,imageryProvider,imageUrl,projection,fieldOfView]);
 const current=photos[index]; const isSphere=useMemo(()=>Boolean(current&&(current.projection==='SPHERE'||current.projection==='EQUIRECTANGULAR'||current.fieldOfView>=300)),[current]);
 const providerTitle=actualProvider==='google'?'GOOGLE STREET VIEW':actualProvider==='geoweedo'?'GEOWEEDO STREET IMAGERY':'KARTAVIEW STREET IMAGERY';
 useEffect(()=>{const panel=rootRef.current?.closest('.map-streetview-panel');const headingLabel=panel?.querySelector<HTMLElement>('.map-streetview-head span');if(headingLabel)headingLabel.textContent=providerTitle;},[providerTitle]);
 useEffect(()=>{const el=sphereRef.current;viewerRef.current?.destroy();viewerRef.current=null;if(!current||!isSphere||!el)return;const v=new Viewer({container:el,panorama:current.imageUrl,navbar:['zoom','move','fullscreen'],defaultYaw:((current.heading||0)*Math.PI)/180,defaultPitch:-0.24,mousemove:true,mousewheel:true,mousewheelCtrlKey:false,touchmoveTwoFingers:false,keyboard:'always',moveInertia:.9,moveSpeed:1.4});viewerRef.current=v;return()=>{if(viewerRef.current===v)viewerRef.current=null;v.destroy();};},[current,isSphere]);
 const resetFlatView=()=>{setFlatZoom(DEFAULT_FLAT_ZOOM);setFlatPanY(DEFAULT_FLAT_PAN_Y);};
 const step=(d:-1|1)=>{resetFlatView();setIndex(v=>Math.min(Math.max(v+d,0),Math.max(0,photos.length-1)));};
 const zoom=(d:number)=>setFlatZoom(v=>Math.min(3.5,Math.max(1,v+d)));
 const startFlatPan=(event:React.PointerEvent<HTMLDivElement>)=>{if((event.target as HTMLElement|null)?.closest('button'))return;event.preventDefault();const stage=event.currentTarget,startY=event.clientY,startPan=flatPanY,height=Math.max(1,stage.getBoundingClientRect().height);setFlatPanning(true);stage.setPointerCapture?.(event.pointerId);const move=(moveEvent:PointerEvent)=>{const delta=((moveEvent.clientY-startY)/height)*100;setFlatPanY(Math.min(MAX_FLAT_PAN_Y,Math.max(MIN_FLAT_PAN_Y,startPan+delta)));};const stop=()=>{setFlatPanning(false);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});window.addEventListener('pointercancel',stop,{once:true});};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{const t=e.target as HTMLElement|null;if(t&&/INPUT|TEXTAREA|SELECT|BUTTON/.test(t.tagName))return;const k=e.key.toLowerCase(),v=viewerRef.current;if((k==='arrowleft'||k==='a')&&isSphere&&v){const p=v.getPosition();v.rotate({yaw:p.yaw-.12,pitch:p.pitch});}else if(k==='arrowleft'||k==='a')step(-1);else if((k==='arrowright'||k==='d')&&isSphere&&v){const p=v.getPosition();v.rotate({yaw:p.yaw+.12,pitch:p.pitch});}else if(k==='arrowright'||k==='d')step(1);else if(k==='arrowup'||k==='w'){if(isSphere&&v){const p=v.getPosition();v.rotate({yaw:p.yaw,pitch:Math.min(Math.PI/2,p.pitch+.1)});}else setFlatPanY(p=>Math.min(MAX_FLAT_PAN_Y,p+4));}else if(k==='arrowdown'||k==='s'){if(isSphere&&v){const p=v.getPosition();v.rotate({yaw:p.yaw,pitch:Math.max(-Math.PI/2,p.pitch-.1)});}else setFlatPanY(p=>Math.max(MIN_FLAT_PAN_Y,p-4));}else return;e.preventDefault();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[isSphere,photos.length]);
 const label=actualProvider==='geoweedo'?'GeoWeedo hosted':actualProvider==='google'?'Google Street View':'KartaView';
 const meters=current?distanceMeters({lat:latitude,lng:longitude},{lat:current.lat,lng:current.lng}):null;
 return <div ref={rootRef} className={`streetview-wrap ${isSphere?'streetview-spherical':'streetview-sequence'}`} data-imagery-provider={actualProvider}>
  {loading&&<div className="map-error"><strong>Loading street imagery…</strong></div>}
  {!loading&&current&&<>{isSphere?<><div ref={sphereRef} className="streetview-canvas interactive-sphere" tabIndex={0}/><div className="street-drag-hint">Drag to look around · wheel/pinch to zoom · WASD/arrows to look</div></>:<div className="street-photo-stage" tabIndex={0} onPointerDown={startFlatPan} onWheel={e=>{e.preventDefault();zoom(e.deltaY<0?.2:-.2);}} style={{cursor:flatPanning?'grabbing':'ns-resize',touchAction:'none'}}>
   <img src={current.imageUrl} alt={`${label} street imagery`} draggable={false} style={{transform:`translateY(${flatPanY}%) scale(${flatZoom})`,transformOrigin:'50% 100%',objectFit:'cover',objectPosition:'50% 100%',pointerEvents:'none',userSelect:'none'}}/>
   <button type="button" className="street-nav street-nav-prev" onClick={()=>step(-1)} disabled={index<=0}>‹</button><button type="button" className="street-nav street-nav-next" onClick={()=>step(1)} disabled={index>=photos.length-1}>›</button>
   <div className="street-zoom-controls"><button onClick={()=>zoom(-.1)} disabled={flatZoom<=1}>−</button><button onClick={resetFlatView} disabled={flatZoom===DEFAULT_FLAT_ZOOM&&flatPanY===DEFAULT_FLAT_PAN_Y}>Reset</button><button onClick={()=>zoom(.1)} disabled={flatZoom>=3.5}>+</button></div>
   <div className="street-drag-hint">Drag up/down to frame street · ← → or A/D: travel · wheel: zoom</div>
  </div>}
   <div className="street-provider-attribution" style={{position:'absolute',right:10,bottom:10,zIndex:12,padding:'5px 8px',borderRadius:7,background:'rgba(5,10,7,.78)',color:'#fff',fontSize:11,pointerEvents:'none'}}>{label} · {attribution}</div>
   {isAdmin&&meters!==null&&<div className="street-admin-diagnostic" style={{position:'absolute',left:10,bottom:10,zIndex:12,padding:'5px 8px',borderRadius:7,background:'rgba(5,10,7,.78)',color:'#cfe8d2',fontSize:11,pointerEvents:'none'}}>Imagery {current.lat.toFixed(6)}, {current.lng.toFixed(6)} · {meters<1000?`${Math.round(meters)} m`:`${(meters/1000).toFixed(2)} km`} from selected location</div>}
  </>}
  {!loading&&error&&<div className="map-error"><strong>Street imagery unavailable</strong><span>{error}</span></div>}
 </div>;
}
