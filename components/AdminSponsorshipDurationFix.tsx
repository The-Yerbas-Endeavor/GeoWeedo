'use client';

import {useEffect} from 'react';

type Preset='1 day'|'1 week'|'1 month'|'1 year';

function localInput(date:Date){
  const copy=new Date(date.getTime()-date.getTimezoneOffset()*60000);
  return copy.toISOString().slice(0,16);
}

function addPreset(start:Date,preset:Preset){
  const end=new Date(start);
  if(preset==='1 day')end.setDate(end.getDate()+1);
  if(preset==='1 week')end.setDate(end.getDate()+7);
  if(preset==='1 month')end.setMonth(end.getMonth()+1);
  if(preset==='1 year')end.setFullYear(end.getFullYear()+1);
  return end;
}

function setReactInputValue(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  if(setter)setter.call(input,value);else input.value=value;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
}

export default function AdminSponsorshipDurationFix(){
  useEffect(()=>{
    if(window.location.pathname!=='/admin/sponsorships')return;

    const handler=(event:MouseEvent)=>{
      const button=(event.target as HTMLElement|null)?.closest('button');
      if(!button)return;
      const label=(button.textContent||'').trim() as Preset;
      if(!['1 day','1 week','1 month','1 year'].includes(label))return;

      const panel=button.closest('.sponsorship-compact');
      if(!panel)return;
      const dateInputs=Array.from(panel.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]'));
      if(dateInputs.length<2)return;

      const startInput=dateInputs[0];
      const endInput=dateInputs[1];
      const start=new Date();
      const end=addPreset(start,label);
      setReactInputValue(startInput,localInput(start));
      setReactInputValue(endInput,localInput(end));

      const buttons=Array.from(panel.querySelectorAll<HTMLButtonElement>('button'));
      for(const item of buttons){
        const text=(item.textContent||'').trim();
        if(['1 day','1 week','1 month','1 year'].includes(text))item.setAttribute('aria-pressed',String(item===button));
      }
    };

    document.addEventListener('click',handler,true);
    return()=>document.removeEventListener('click',handler,true);
  },[]);
  return null;
}
