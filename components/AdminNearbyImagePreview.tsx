'use client';

import { useEffect, useState } from 'react';

type Photo={imageUrl?:string;shotDate?:string|null};
type PreviewData={provider?:string;photos?:Photo[];initialIndex?:number;error?:string};

export default function AdminNearbyImagePreview({latitude,longitude}:{latitude:number;longitude:number}){
 const[photo,setPhoto]=useState<Photo|null>(null),[status,setStatus]=useState('Loading nearby imagery…');
 useEffect(()=>{
  const controller=new AbortController();
  setPhoto(null);setStatus('Loading nearby imagery…');
  const timer=setTimeout(async()=>{
   try{
    // Do not force a provider here. The Street View API resolves the current
    // Admin provider setting (Google, KartaView, or Google → KartaView auto).
    const response=await fetch(`/api/street-imagery?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`,{cache:'no-store',signal:controller.signal});
    const data:PreviewData=await response.json();
    if(!response.ok)throw new Error(data.error||'Imagery lookup failed.');
    const photos:Array<Photo>=Array.isArray(data.photos)?data.photos:[];
    const index=Math.min(Math.max(Number(data.initialIndex||0),0),Math.max(photos.length-1,0));
    const next=photos[index]||photos[0]||null;
    setPhoto(next);
    const provider=data.provider==='google'?'Google':data.provider==='kartaview'?'KartaView':'Street View';
    setStatus(next?`${provider} nearby street image`:'No nearby street imagery found.');
   }catch(error){
    if((error as any)?.name==='AbortError')return;
    setStatus(error instanceof Error?error.message:'Imagery lookup failed.');
   }
  },350);
  return()=>{clearTimeout(timer);controller.abort();};
 },[latitude,longitude]);
 return <div className="admin-nearby-preview">
  {photo?.imageUrl?<img src={photo.imageUrl} alt="Nearby imagery preview"/>:<div className="admin-nearby-preview-empty">{status}</div>}
  <div className="admin-nearby-preview-meta"><strong>{status}</strong>{photo?.shotDate&&<span>{photo.shotDate}</span>}</div>
 </div>;
}
