'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import StateGroupedDispensaryManager from '@/components/StateGroupedDispensaryManager';

export default function AdminStateGroupsPortal(){
  const [host,setHost]=useState<Element|null>(null);
  useEffect(()=>{
    setHost(document.querySelector('.dispensaries-admin-order .admin-shell'));
  },[]);
  if(!host)return null;
  return createPortal(<StateGroupedDispensaryManager/>,host);
}
