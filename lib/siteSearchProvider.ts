import 'server-only';

import { getCachedSiteSearch, setCachedSiteSearch } from '@/lib/siteSearchCache';

export type SiteSearchProvider='searxng'|'google';
export type SiteSearchResult={link:string;title:string;snippet:string};

const DEFAULT_MIN_INTERVAL_MS=1200;
const DEFAULT_TIMEOUT_MS=12000;
const DEFAULT_MAX_RETRIES=3;
let nextSearchAt=0;
let pacingQueue:Promise<void>=Promise.resolve();

export function configuredSiteSearchProvider():SiteSearchProvider|null{
 if(process.env.SEARXNG_URL)return 'searxng';
 if(process.env.GOOGLE_CUSTOM_SEARCH_API_KEY&&process.env.GOOGLE_CUSTOM_SEARCH_CX)return 'google';
 return null;
}

export function siteSearchProviderLabel(provider:SiteSearchProvider|null){
 if(provider==='searxng')return 'Self-hosted SearXNG';
 if(provider==='google')return 'Google Custom Search (legacy)';
 return 'Not configured';
}

function numberEnv(name:string,fallback:number,min=0){
 const value=Number(process.env[name]||fallback);
 return Number.isFinite(value)&&value>=min?value:fallback;
}

function sleep(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}

async function waitForSearchSlot(){
 const minInterval=numberEnv('SITE_SEARCH_MIN_INTERVAL_MS',DEFAULT_MIN_INTERVAL_MS);
 const current=pacingQueue.then(async()=>{
  const now=Date.now();
  const wait=Math.max(0,nextSearchAt-now);
  if(wait)await sleep(wait);
  nextSearchAt=Date.now()+minInterval;
 });
 pacingQueue=current.catch(()=>undefined);
 await current;
}

function normalizeSearxngBase(raw:string){
 const url=new URL(raw);
 url.pathname=url.pathname.replace(/\/+$/,'');
 url.search='';
 url.hash='';
 return url;
}

function retryAfterMs(response:Response){
 const raw=response.headers.get('retry-after');
 if(!raw)return null;
 const seconds=Number(raw);
 if(Number.isFinite(seconds))return Math.max(0,seconds*1000);
 const at=Date.parse(raw);
 return Number.isFinite(at)?Math.max(0,at-Date.now()):null;
}

async function fetchWithRetry(url:URL,init:RequestInit,label:string){
 const timeoutMs=numberEnv('SITE_SEARCH_TIMEOUT_MS',DEFAULT_TIMEOUT_MS,1000);
 const maxRetries=Math.floor(numberEnv('SITE_SEARCH_MAX_RETRIES',DEFAULT_MAX_RETRIES));
 let lastError:unknown;

 for(let attempt=0;attempt<=maxRetries;attempt+=1){
  await waitForSearchSlot();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetch(url,{...init,signal:controller.signal});
   if(response.ok)return response;
   const retryable=response.status===429||response.status>=500;
   if(!retryable||attempt>=maxRetries)throw new Error(`${label} returned ${response.status}.`);
   const backoff=retryAfterMs(response)??Math.min(1000*(2**attempt),10000);
   await sleep(backoff);
  }catch(error){
   lastError=error;
   if(attempt>=maxRetries)throw error;
   await sleep(Math.min(1000*(2**attempt),10000));
  }finally{
   clearTimeout(timer);
  }
 }
 throw lastError instanceof Error?lastError:new Error(`${label} failed.`);
}

async function searxngSearch(query:string):Promise<SiteSearchResult[]>{
 const raw=String(process.env.SEARXNG_URL||'').trim();
 if(!raw)throw new Error('Self-hosted site discovery is not configured. Set SEARXNG_URL.');
 const endpoint=normalizeSearxngBase(raw);
 endpoint.pathname=`${endpoint.pathname}/search`.replace(/\/+/g,'/');
 endpoint.searchParams.set('q',query);
 endpoint.searchParams.set('format','json');
 endpoint.searchParams.set('language','en');
 endpoint.searchParams.set('safesearch','1');
 const response=await fetchWithRetry(endpoint,{cache:'no-store',headers:{Accept:'application/json','User-Agent':'GeoWeedo/1.0 official-site discovery'}},'SearXNG website discovery');
 const data=await response.json();
 return (Array.isArray(data?.results)?data.results:[]).slice(0,10).map((item:any)=>({link:String(item?.url||''),title:String(item?.title||''),snippet:String(item?.content||item?.snippet||'')})).filter((item:SiteSearchResult)=>Boolean(item.link));
}

async function googleSearch(query:string):Promise<SiteSearchResult[]>{
 const key=process.env.GOOGLE_CUSTOM_SEARCH_API_KEY||'',cx=process.env.GOOGLE_CUSTOM_SEARCH_CX||'';
 if(!key||!cx)throw new Error('Google Custom Search is not configured.');
 const endpoint=new URL('https://www.googleapis.com/customsearch/v1');
 endpoint.searchParams.set('key',key);endpoint.searchParams.set('cx',cx);endpoint.searchParams.set('q',query);endpoint.searchParams.set('num','10');
 const response=await fetchWithRetry(endpoint,{cache:'no-store'},'Google website discovery search');
 const data=await response.json();
 return (Array.isArray(data?.items)?data.items:[]).map((item:any)=>({link:String(item?.link||''),title:String(item?.title||''),snippet:String(item?.snippet||'')})).filter((item:SiteSearchResult)=>Boolean(item.link));
}

export async function searchOfficialSiteCandidates(query:string){
 const provider=configuredSiteSearchProvider();
 if(!provider)throw new Error('Official-site discovery is not configured. Set SEARXNG_URL for a self-hosted search instance or use existing Google Custom Search credentials.');
 const normalized=query.trim();
 const cached=getCachedSiteSearch(provider,normalized);
 if(cached)return{provider,results:cached,cached:true};
 const results=provider==='searxng'?await searxngSearch(normalized):await googleSearch(normalized);
 setCachedSiteSearch(provider,normalized,results);
 return{provider,results,cached:false};
}
