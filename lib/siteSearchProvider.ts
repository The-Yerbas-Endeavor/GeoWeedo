import 'server-only';

export type SiteSearchProvider='searxng'|'google';
export type SiteSearchResult={link:string;title:string;snippet:string};

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

function normalizeSearxngBase(raw:string){
 const url=new URL(raw);
 url.pathname=url.pathname.replace(/\/+$/,'');
 url.search='';
 url.hash='';
 return url;
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
 const response=await fetch(endpoint,{cache:'no-store',headers:{Accept:'application/json','User-Agent':'GeoWeedo/1.0 official-site discovery'}});
 if(!response.ok)throw new Error(`SearXNG website discovery returned ${response.status}.`);
 const data=await response.json();
 return (Array.isArray(data?.results)?data.results:[]).slice(0,10).map((item:any)=>({link:String(item?.url||''),title:String(item?.title||''),snippet:String(item?.content||item?.snippet||'')})).filter((item:SiteSearchResult)=>Boolean(item.link));
}

async function googleSearch(query:string):Promise<SiteSearchResult[]>{
 const key=process.env.GOOGLE_CUSTOM_SEARCH_API_KEY||'',cx=process.env.GOOGLE_CUSTOM_SEARCH_CX||'';
 if(!key||!cx)throw new Error('Google Custom Search is not configured.');
 const endpoint=new URL('https://www.googleapis.com/customsearch/v1');
 endpoint.searchParams.set('key',key);endpoint.searchParams.set('cx',cx);endpoint.searchParams.set('q',query);endpoint.searchParams.set('num','10');
 const response=await fetch(endpoint,{cache:'no-store'});
 if(!response.ok)throw new Error(`Google website discovery search returned ${response.status}.`);
 const data=await response.json();
 return (Array.isArray(data?.items)?data.items:[]).map((item:any)=>({link:String(item?.link||''),title:String(item?.title||''),snippet:String(item?.snippet||'')})).filter((item:SiteSearchResult)=>Boolean(item.link));
}

export async function searchOfficialSiteCandidates(query:string){
 const provider=configuredSiteSearchProvider();
 if(!provider)throw new Error('Official-site discovery is not configured. Set SEARXNG_URL for a self-hosted search instance or use existing Google Custom Search credentials.');
 const results=provider==='searxng'?await searxngSearch(query):await googleSearch(query);
 return{provider,results};
}
