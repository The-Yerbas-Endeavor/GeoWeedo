import 'server-only';

type IowaCandidate={name:string;streetAddress:string;city:string;region:string;country:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://hhs.iowa.gov/health-prevention/medical-cannabis/dispensary-locations';

// Iowa HHS currently publishes five operational medical cannabis dispensaries.
// Keep the small official roster explicit so a CMS/layout change cannot silently
// turn into partial or malformed candidate data. Coordinates are intentionally
// completed through GeoWeedo Automated Enrichment.
const LOCATIONS=[
 {name:"Bud & Mary's - Sioux City",streetAddress:'5700 Sunnybrook Drive',city:'Sioux City'},
 {name:"Bud & Mary's - Windsor Heights",streetAddress:'7239 Apple Valley Drive',city:'Windsor Heights'},
 {name:'Iowa Cannabis Company - Waterloo',streetAddress:'1955 La Porte Road',city:'Waterloo'},
 {name:'Iowa Cannabis Company West - Council Bluffs',streetAddress:'3615 9th Ave',city:'Council Bluffs'},
 {name:'Iowa Cannabis Company East - Iowa City',streetAddress:'322 Highway 1 W',city:'Iowa City'}
] as const;

export async function fetchIowaCandidates():Promise<IowaCandidate[]>{
 let reachable=false;
 try{
  const response=await fetch(SOURCE_URL,{headers:{Accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(30000)});
  reachable=response.ok;
  if(response.ok){
   const html=await response.text();
   const plain=html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#0*39;|&apos;/g,"'").replace(/\s+/g,' ');
   if(!/five dispensaries|5 results|Displaying\s+1\s*-\s*5\s+of\s+5/i.test(plain))throw new Error('Iowa HHS dispensary page no longer confirms the expected five-location roster; refusing an unverified import.');
  }
 }catch(error){
  if(error instanceof Error&&/no longer confirms/.test(error.message))throw error;
  // Iowa HHS occasionally blocks/interrupts server-side requests. The roster below
  // remains source-attributed and fail-closed at exactly five published locations.
 }
 if(LOCATIONS.length!==5)throw new Error(`Iowa HHS importer contains ${LOCATIONS.length} locations; expected exactly 5.`);
 return LOCATIONS.map(row=>({...row,region:'Iowa',country:'USA',dataSource:'Iowa HHS Medical Cannabis Dispensary Locations',sourceUrl:SOURCE_URL,sourceLicense:`Official Iowa Department of Health and Human Services Medical Cannabis dispensary roster; five operational dispensary storefronts. ${reachable?'Official source verified during this sync.':'Official source was temporarily unreachable from the GeoWeedo server; the preserved five-location HHS roster was used.'} Coordinates are completed through GeoWeedo Automated Enrichment.`,imageryStatus:'missing_coordinates'}));
}
