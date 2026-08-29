import 'server-only';

import type { NextRequest } from 'next/server';

export type RequestGeo={ip:string|null;city:string|null;region:string|null;country:string|null;latitude:number|null;longitude:number|null;source:string};

function cleanIp(value:string|null|undefined){
  const raw=String(value||'').trim();
  if(!raw)return null;
  const bracket=raw.match(/^\[([^\]]+)\](?::\d+)?$/);
  if(bracket)return bracket[1];
  if(/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(raw))return raw.replace(/:\d+$/,'');
  return raw;
}

export function getRequestIp(request:NextRequest){
  const cf=cleanIp(request.headers.get('cf-connecting-ip'));
  if(cf)return cf;
  const real=cleanIp(request.headers.get('x-real-ip'));
  if(real)return real;
  const forwarded=request.headers.get('x-forwarded-for');
  if(forwarded){
    const parts=forwarded.split(',').map(v=>cleanIp(v)).filter((v):v is string=>Boolean(v));
    if(parts.length)return parts[parts.length-1];
  }
  return null;
}

function headerGeo(request:NextRequest,ip:string|null):RequestGeo|null{
  const city=request.headers.get('x-vercel-ip-city')||request.headers.get('cf-ipcity');
  const region=request.headers.get('x-vercel-ip-country-region')||request.headers.get('cf-region');
  const country=request.headers.get('x-vercel-ip-country')||request.headers.get('cf-ipcountry');
  const lat=Number(request.headers.get('x-vercel-ip-latitude'));
  const lng=Number(request.headers.get('x-vercel-ip-longitude'));
  if(!city&&!region&&!country)return null;
  return{ip,city:city?decodeURIComponent(city):null,region:region||null,country:country||null,latitude:Number.isFinite(lat)?lat:null,longitude:Number.isFinite(lng)?lng:null,source:'edge-headers'};
}

function isLocalIp(ip:string){
  return ip==='127.0.0.1'||ip==='::1'||ip.startsWith('10.')||ip.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||ip.startsWith('fc')||ip.startsWith('fd');
}

export async function resolveRequestGeo(request:NextRequest):Promise<RequestGeo>{
  const ip=getRequestIp(request);
  const fromHeaders=headerGeo(request,ip);
  if(fromHeaders)return fromHeaders;
  const empty:RequestGeo={ip,city:null,region:null,country:null,latitude:null,longitude:null,source:'ip-only'};
  if(!ip||isLocalIp(ip))return empty;
  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),1800);
    const response=await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}}).finally(()=>clearTimeout(timeout));
    if(!response.ok)return empty;
    const data=await response.json().catch(()=>null) as any;
    if(!data||data.success===false)return empty;
    return{ip,city:data.city||null,region:data.region||null,country:data.country||data.country_code||null,latitude:Number.isFinite(Number(data.latitude))?Number(data.latitude):null,longitude:Number.isFinite(Number(data.longitude))?Number(data.longitude):null,source:'ipwho.is'};
  }catch{return empty;}
}
