'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';

type Props = { latitude:number; longitude:number; heading?:number; photoId?:string; imageryProvider?:'kartaview'|'geoweedo'; imageUrl?:string; projection?:string; fieldOfView?:number };
type StreetPhoto = { id:string; lat:number; lng:number; heading:number; fieldOfView:number; projection:string; imageUrl:string; sequenceId:string; sequenceIndex:number; shotDate?:string|null };
type ApiProvider = 'google'|'kartaview';
type ApiResponse = { provider?:ApiProvider; photos?:StreetPhoto[]; initialIndex?:number; message?:string; error?:string };

async function readApiResponse(response:Response):Promise<ApiResponse>{
 const text=await response.text();
 if(!text.trim())throw new Error(`Street imagery API returned an empty response (${response.status}).`);
 try{return JSON.parse(text) as ApiResponse;}catch{
  const looksHtml=/^\s*</.test(text);
  throw new Error(looksHtml?`Street imagery API returned an HTML error page (${response.status}). Check the GeoWeedo server log.`:`Street imagery API returned an invalid response (${response.status}).`);
 }
}

export default function StreetViewStage({latitude,longitude,heading=0,photoId,imageryProvider='kartaview',imageUrl,projection='',fieldOfView=0}:Props){
 const sphereRef=useRef<HTMLDivElement|null>(null), viewerRef=useRef<Viewer|null>(null);
 const [photos,setPhotos]=useState<StreetPhoto[]>([]),[index,setIndex]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[flatZoom,setFlatZoom]=useState(1),[actualProvider,setActualProvider]=useState<'google'|'kartaview'|'geoweedo'>(imageryProvider==='geoweedo'?'geoweedo':'kartaview');
 useEffect(()=>{setError(null);setIndex(0);setFlatZoom(1);if(imageryProvider==='geoweedo'){setActualProvider('geoweedo');if(!imageUrl){setPhotos([]);setError('The approved GeoWeedo-hosted image is missing.');setLoading(false);return;}setPhotos([{id:photoId||'geoweedo-hosted',lat:latitude,lng:longitude,heading,fieldOfView,projection:projection.toUpperCase(),imageUrl,sequenceId:'geoweedo',sequenceIndex:0}]);setLoading(false);return;}const c=new AbortController();setLoading(true);setPhotos([]);const q=new URLSearchParams({lat:String(latitude),lng:String(longitude)});if(photoId)q.set('photoId',photoId);fetch(`/api/street-imagery?${q}`,{signal:c.signal,cache:'no-store'}).then(async r=>{const d=await readApiResponse(r);if(!r.ok)throw new Error(d.error||`Street imagery lookup failed (${r.status}).`);return d;}).then(d=>{setActualProvider(d.provider==='google'?'google':'kartaview');const p=d.photos||[];setPhotos(p);setIndex(Math.min(Math.max(d.initialIndex||0,0),Math.max(0,p.length-1)));if(!p.length)setError(d.message||'No street imagery is available near this location yet.');}).catch(e=>{if(e?.name!=='AbortError')setError(e instanceof Error?e.message:'Street imagery failed to load.');}).finally(()=>setLoading(false));return()=>c.abort();},[latitude,longitude,heading,photoId,imageryProvider,imageUrl,projection,fieldOfView]);
 const current=photos[index]; const isSphere=useMemo(()=>Boolean(current&&(current.projection==='SPHERE'||current.projection==='EQUIRECTANGULAR'||current.fieldOfView>=300)),[current]);
 useEffect(()=>{const el=sphereRef.current;viewerRef.current?.destroy();viewerRef.current=null;if(!current||!isSphere||!el)return;const v=new Viewer({container:el,panorama:current.imageUrl,navbar:['zoom','move','fullscreen'],defaultYaw:((current.heading||0)*Math.PI)/180,mousemove:true,mousewheel:true,mousewheelCtrlKey:false,touchmoveTwoFingers:false,keyboard:'always',moveInertia:.9,moveSpeed:1.4});viewerRef.current=v;return()=>{if(viewerRef.current===v)viewerRef.current=null;v.destroy();};},[current,isSphere]);
 const step=(d:-1|1)=>{setFlatZoom(1);setIndex(v=>Math.min(Math.max(v+d,0),Math.max(0,photos.length-1)));};
 const zoom=(d:number)=>setFlatZoom(v=>Math.min(3.5,Math.max(1,v+d)));
 useEffect(()=>{const key=(e:KeyboardEvent)=>{const t=e.target as HTMLElement|null;if(t&&/INPUT|TEXTAREA|SELECT|BUTTON/.test(t.tagName))return;const k=e.key.toLowerCase(),v=viewerRef.current;if((k==='arrowleft'||k==='a')&&isSphere&&v){const p=v.getPosition();v.rotate({yaw:p.yaw-.12,pitch:p.pitch});}else if(k==='arrowleft'||k==='a')step(-1);else if((k==='arrowright'||k==='d')&&isSphere&&v){const p=v.getPosition();v.rotate({yaw:p.yaw+.12,pitch:p.pitch});}else if(k==='arrowright'||k==='d')step(1);else if(k==='arrowup'||k==='w'){if(isSphere&&v){const p=v.getPosition();v.rotate({yaw:p.yaw,pitch:Math.min(Math.PI/2,p.pitch+.1)});}else step(1);}else if(k==='arrowdown'||k==='s'){if(isSphere&&v){const p=v.getPosition();v.rotate({yaw:p.yaw,pitch:Math.max(-Math.PI/2,p.pitch-.1)});}else step(-1);}else return;e.preventDefault();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[isSphere,photos.length]);
 const label=actualProvider==='geoweedo'?'GeoWeedo hosted':actualProvider==='google'?'Google Street View':'KartaView';
 return <div className={`streetview-wrap ${isSphere?'streetview-spherical':'streetview-sequence'}`}>
  {loading&&<div className="map-error"><strong>Loading street imagery…</strong></div>}
  {!loading&&current&&<>{isSphere?<><div ref={sphereRef} className="streetview-canvas interactive-sphere" tabIndex={0}/><div className="street-drag-hint">Drag to look around · wheel/pinch to zoom · WASD/arrows to look</div></>:<div className="street-photo-stage" tabIndex={0} onWheel={e=>{e.preventDefault();zoom(e.deltaY<0?.2:-.2);}}>
   <img src={current.imageUrl} alt={`${label} street imagery`} draggable={false} style={{transform:`scale(${flatZoom})`}}/>
   <button type="button" className="street-nav street-nav-prev" onClick={()=>step(-1)} disabled={index<=0}>‹</button><button type="button" className="street-nav street-nav-next" onClick={()=>step(1)} disabled={index>=photos.length-1}>›</button>
   <div className="street-zoom-controls"><button onClick={()=>zoom(-.25)} disabled={flatZoom<=1}>−</button><button onClick={()=>setFlatZoom(1)} disabled={flatZoom===1}>Reset</button><button onClick={()=>zoom(.25)} disabled={flatZoom>=3.5}>+</button></div>
   <div className="street-drag-hint">← → or A/D: travel street · wheel: zoom</div>
  </div>}</>}
  {!loading&&error&&<div className="map-error"><strong>Street imagery unavailable</strong><span>{error}</span></div>}
 </div>;
}
