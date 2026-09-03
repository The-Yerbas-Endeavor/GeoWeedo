'use client';

import {useEffect} from 'react';

const HOURS_PLACEHOLDER='9:00 AM - 9:00 PM or Closed';
const DEFAULT_HOURS='9:00 AM - 9:00 PM';

export default function AdminHoursInputDefaults(){
 useEffect(()=>{
  const fillDefault=(event:Event)=>{
   const input=event.target as HTMLInputElement|null;
   if(!input||input.tagName!=='INPUT'||input.placeholder!==HOURS_PLACEHOLDER||input.value.trim())return;
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
   if(setter)setter.call(input,DEFAULT_HOURS);else input.value=DEFAULT_HOURS;
   input.dispatchEvent(new Event('input',{bubbles:true}));
   window.requestAnimationFrame(()=>{
    try{input.setSelectionRange(0,7);}catch{}
   });
  };
  document.addEventListener('focusin',fillDefault);
  return()=>document.removeEventListener('focusin',fillDefault);
 },[]);
 return null;
}
