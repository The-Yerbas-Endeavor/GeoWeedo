import 'server-only';

export type SiteSearchProvider='brave'|'google';
export type SiteSearchResult={link:string;title:string;snippet:string};

export function configuredSiteSearchProvider():SiteSearchProvider|null{
 if(process.env.BRAVE_SEARCH_API_KEY)return 'brave';
 if(process.env.GOOGLE_CUSTOM_SEARCH_API_KEY&&process.env.GOOGLE_CUSTOM_SEARCH_CX)return 'google';
 return null;
}

export function siteSearchProviderLabel(provider:SiteSearchProvider|null){
 if(provider==='brave')return 'Brave Search API';
 if(provider==='google')return 'Google Custom Search';
 return 'Not configured';
}

async function braveSearch(query:string):Promise<SiteSearchResult[]>{
 const key=process.env.BRAVE_SEARCH_API_KEY||'';
 if(!key)throw new Error('Brave Search API is not configured. Set BRAVE_SEARCH_API_KEY.');
 const endpoint=new URL('https://api.search.brave.com/res/v1/web/search');
 endpoint.searchParams.set('q',query);
 endpoint.searchParams.set('count','10');
 endpoint.searchParams.set('search_lang','en');
 endpoint.searchParams.set('safesearch','moderate');
 const response=await fetch(endpoint,{cache:'no-store',headers:{Accept:'application/json','X-Subscription-Token':key}});
 if(!response.ok)throw new Error(`Brave website discovery search returned ${response.status}.`);
 const data=await response.json();
 return (Array.isArray(data?.web?.results)?data.web.results:[]).map((item:any)=>({link:String(item?.url||''),title:String(item?.title||''),snippet:String(item?.description||'')})).filter((item:SiteSearchResult)=>Boolean(item.link));
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
 if(!provider)throw new Error('Official-site discovery is not configured. Set BRAVE_SEARCH_API_KEY or existing Google Custom Search credentials.');
 const results=provider==='brave'?await braveSearch(query):await googleSearch(query);
 return{provider,results};
}
