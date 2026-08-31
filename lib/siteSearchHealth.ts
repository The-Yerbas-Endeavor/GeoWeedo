import 'server-only';

import {configuredSiteSearchProvider,siteSearchProviderLabel,searchOfficialSiteCandidates} from '@/lib/siteSearchProvider';

export type SiteSearchHealth={configured:boolean;provider:string|null;label:string;ok:boolean;latencyMs:number|null;message:string};

export async function checkSiteSearchHealth():Promise<SiteSearchHealth>{
 const provider=configuredSiteSearchProvider();
 const label=siteSearchProviderLabel(provider);
 if(!provider)return{configured:false,provider:null,label,ok:false,latencyMs:null,message:'Official-site discovery is not configured.'};
 const started=Date.now();
 try{
  await searchOfficialSiteCandidates('GeoWeedo health check');
  return{configured:true,provider,label,ok:true,latencyMs:Date.now()-started,message:'Discovery search is reachable.'};
 }catch(error){
  return{configured:true,provider,label,ok:false,latencyMs:Date.now()-started,message:error instanceof Error?error.message:'Discovery health check failed.'};
 }
}
