import 'server-only';

export const NEBRASKA_MCC_SOURCE_URL='https://mcc.nebraska.gov/';
export const NEBRASKA_MCC_RULES_URL='https://mcc.nebraska.gov/rules-regulations';

export type NebraskaCandidate={
 name:string;
 streetAddress?:string;
 city?:string;
 region:string;
 country:string;
 latitude?:number;
 longitude?:number;
 website?:string;
 licenseNumber?:string;
 dataSource:string;
 sourceUrl:string;
 sourceLicense:string;
 imageryStatus:'unchecked'|'missing_coordinates';
};

/**
 * Nebraska has a regulated medical-cannabis program, but as of 2026-09-06 the
 * Nebraska Medical Cannabis Commission has not published an operational
 * dispensary roster. MCC's August 2026 minutes describe dispensary
 * infrastructure/licensing as still developing, while manufacturer licensing
 * remains in progress. GeoWeedo must not invent storefronts from applicants,
 * cultivators, hemp businesses, or other non-dispensary records.
 *
 * Keep this official-source module wired so Nebraska can be activated as soon
 * as MCC publishes licensed/operational dispensary names and locations.
 */
export async function fetchNebraskaCandidates():Promise<NebraskaCandidate[]>{
 let response:Response;
 try{
  response=await fetch(NEBRASKA_MCC_SOURCE_URL,{
   headers:{
    Accept:'text/html,application/xhtml+xml',
    'User-Agent':'Mozilla/5.0 (compatible; GeoWeedo/0.7; +https://geoweedo.com)',
    'Accept-Language':'en-US,en;q=0.9'
   },
   cache:'no-store',
   signal:AbortSignal.timeout(30000)
  });
 }catch(error){
  throw new Error(`Nebraska MCC could not be reached: ${error instanceof Error?error.message:String(error)}`);
 }
 if(!response.ok)throw new Error(`Nebraska MCC returned ${response.status}.`);
 const html=await response.text();
 const plain=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();

 // Fail closed until MCC itself publishes a dispensary directory or licensed
 // dispensary roster. Merely mentioning dispensaries/applications is not enough
 // evidence to create public GeoWeedo location records.
 const hasPublishedDirectory=/licensed dispensar(?:y|ies)\s+(?:directory|locations|roster|list)|dispensar(?:y|ies)\s+(?:directory|locations|roster)/i.test(plain);
 if(!hasPublishedDirectory){
  throw new Error('Nebraska MCC has not yet published an official licensed/operational dispensary roster. Nebraska is integrated in GeoWeedo but remains pending until the Commission publishes dispensary locations.');
 }

 throw new Error('Nebraska MCC now appears to reference a dispensary directory. Review the official source and add its parser before importing so GeoWeedo does not ingest a partial or non-operational roster.');
}
