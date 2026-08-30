'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const VISITOR_KEY='geoweedo_visitor_id';
const SESSION_KEY='geoweedo_session_id';
const OPTOUT_KEY='geoweedo_analytics_optout';

function id(){return crypto.randomUUID();}
function getOrCreate(storage:Storage,key:string){let value=storage.getItem(key);if(!value){value=id();storage.setItem(key,value);}return value;}
function optedOut(){try{return localStorage.getItem(OPTOUT_KEY)==='1'||navigator.doNotTrack==='1';}catch{return false;}}
function common(){return{language:navigator.language||'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',screenWidth:window.screen?.width||0,screenHeight:window.screen?.height||0,referrer:document.referrer||''};}
function send(payload:Record<string,unknown>,beacon=false){
 if(optedOut())return;
 const body=JSON.stringify(payload);
 if(beacon&&navigator.sendBeacon){navigator.sendBeacon('/api/analytics/event',new Blob([body],{type:'application/json'}));return;}
 fetch('/api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true,cache:'no-store'}).catch(()=>{});
}

export function trackAnalyticsEvent(eventType:string,properties?:Record<string,unknown>){
 if(typeof window==='undefined'||optedOut())return;
 try{
  const visitorId=getOrCreate(localStorage,VISITOR_KEY),sessionId=getOrCreate(sessionStorage,SESSION_KEY);
  send({visitorId,sessionId,eventType,path:location.pathname,properties:properties||null,...common()});
 }catch{}
}

export default function AnalyticsTracker(){
 const pathname=usePathname();
 const pageStart=useRef(Date.now());
 const previousPath=useRef<string|null>(null);
 useEffect(()=>{
  if(optedOut())return;
  let visitorId='',sessionId='';
  try{visitorId=getOrCreate(localStorage,VISITOR_KEY);sessionId=getOrCreate(sessionStorage,SESSION_KEY);}catch{return;}
  const now=Date.now();
  if(previousPath.current){send({visitorId,sessionId,eventType:'page_leave',path:previousPath.current,durationMs:Math.max(0,now-pageStart.current),...common()});}
  previousPath.current=pathname||'/';pageStart.current=now;
  send({visitorId,sessionId,eventType:'page_view',path:pathname||'/',...common()});
 },[pathname]);
 useEffect(()=>{
  const finish=()=>{if(optedOut()||!previousPath.current)return;try{const visitorId=getOrCreate(localStorage,VISITOR_KEY),sessionId=getOrCreate(sessionStorage,SESSION_KEY);send({visitorId,sessionId,eventType:'page_leave',path:previousPath.current,durationMs:Math.max(0,Date.now()-pageStart.current),...common()},true);}catch{}};
  const onVisibility=()=>{if(document.visibilityState==='hidden')finish();else pageStart.current=Date.now();};
  const onError=(event:ErrorEvent)=>trackAnalyticsEvent('client_error',{message:String(event.message||'Client error').slice(0,300),source:String(event.filename||'').slice(0,300)});
  const onRejection=(event:PromiseRejectionEvent)=>trackAnalyticsEvent('unhandled_rejection',{message:String(event.reason instanceof Error?event.reason.message:event.reason||'Unhandled rejection').slice(0,300)});
  window.addEventListener('pagehide',finish);document.addEventListener('visibilitychange',onVisibility);window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onRejection);
  return()=>{window.removeEventListener('pagehide',finish);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onRejection);};
 },[]);
 return null;
}
