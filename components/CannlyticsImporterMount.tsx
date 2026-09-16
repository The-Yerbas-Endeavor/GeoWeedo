'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import CannlyticsImporter from './CannlyticsImporter';

export default function CannlyticsImporterMount(){
  const[target,setTarget]=useState<HTMLElement|null>(null);
  useEffect(()=>{
    const main=document.querySelector('.admin-shell') as HTMLElement|null;
    setTarget(main);
  },[]);
  if(!target)return null;
  return createPortal(<CannlyticsImporter/>,target);
}
