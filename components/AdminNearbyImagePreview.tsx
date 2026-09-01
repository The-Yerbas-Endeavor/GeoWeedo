'use client';

import { useEffect, useState } from 'react';

type Photo={imageUrl?:string;shotDate?:string|null};
type PreviewData={provider?:string;photos?:Photo[];initialIndex?:number;error?:string};

function validCoordinates(latitude:number,longitude:number){
 return Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180&&!(latitude===0&&longitude===0);
}

export default function AdminNearbyImagePreview({latitude,longitude}:{latitude:number;longitude:number}){
 const[photo,setPhoto]=useState<Photo|null>(null),[status,setStatus]=useState('Loading nearby imagery…');
 useEffect(()=>{
  if(!validCoordinates(latitude,longitude)){
   setPhoto(null);
   setStatus('Save valid coordinates to preview Street View.');
   return;
  }
  const controller=new AbortController();
  setPhoto(null);setStatus('Loading nearby Street View…');
  const timer=setTimeout(async()=>{
   try{
    // Coordinate verification is always Google-first. KartaView is only used
    // when Google has no usable Street View at valid coordinates.
    const response=await fetch(`/api/street-imagery?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}&provider=auto`,{cache:'no-store',signal:controller.signal});
    const data:PreviewData=await response.json();
    if(!response.ok)throw new Error(data.error||'Street View lookup failed.');
    const photos:Array<Photo>=Array.isArray(data.photos)?data.photos:[];
    const index=Math.min(Math.max(Number(data.initialIndex||0),0),Math.max(photos.length-1,0));
    const next=photos[index]||photos[0]||null;
    setPhoto(next);
    const provider=data.provider==='google'?'Google':data.provider==='kartaview'?'Fallback Street View':'Street View';
    setStatus(next?`${provider} nearby street image`:'No nearby Street View found.');
   }catch(error){
    if((error as any)?.name==='AbortError')return;
    setStatus(error instanceof Error?error.message:'Street View lookup failed.');
   }
  },350);
  return()=>{clearTimeout(timer);controller.abort();};
 },[latitude,longitude]);
 return <div className="admin-nearby-preview">
  {photo?.imageUrl?<img src={photo.imageUrl} alt="Nearby Street View preview"/>:<div className="admin-nearby-preview-empty">{status}</div>}
  <div className="admin-nearby-preview-meta"><strong>{status}</strong>{photo?.shotDate&&<span>{photo.shotDate}</span>}</div>
 </div>;
}
