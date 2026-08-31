import 'server-only';

export type SiteSearchProvider='google';
export type SiteSearchResult={link:string;title:string;snippet:string};

export function configuredSiteSearchProvider():SiteSearchProvider|null{
 if(process.env.GOOGLE_CUSTOM_SEARCH_API_KEY&&process.env.GOOGLE_CUSTOM_SEARCH_CX)return 'google';
 return null;
}

export function siteSearchProviderLabel(provider:SiteSearchProvider|null){
 if(provider==='google')return 'Google Custom Search (legacy)';
 return 'Not configured';
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
 if(!provider)throw new Error('Optional web-search discovery is not configured. GeoWeedo will continue using official datasets and websites already stored on records.');
 const results=await googleSearch(query);
 return{provider,results};
}
