'use client';

import { useEffect } from 'react';

export default function HomeMapLocationDeepLink(){
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search),locationId=params.get('location');
  if(!locationId)return;
  const run=()=>window.dispatchEvent(new CustomEvent('geoweedo-focus-location',{detail:{locationId}}));
  const timers=[150,500,1000,1800].map(delay=>window.setTimeout(run,delay));
  return()=>timers.forEach(window.clearTimeout);
 },[]);
 return null;
}
