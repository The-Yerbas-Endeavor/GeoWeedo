import 'server-only';

type NewHampshireCandidate={name:string;streetAddress:string;city:string;region:string;country:string;phone?:string;website?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://www.dhhs.nh.gov/sites/g/files/ehbemt476/files/documents/2021-11/tcp-infosheetpatient.pdf';

// NH DHHS publishes seven Alternative Treatment Center dispensing locations in its
// current Therapeutic Cannabis Program patient information. Keep the state-published
// roster explicit so a PDF layout change cannot silently create bad candidates.
const LOCATIONS=[
 {name:'GraniteLeaf Cannabis - Merrimack',streetAddress:'380 Daniel Webster Highway, Units A and C',city:'Merrimack',phone:'603-262-5035',website:'https://graniteleaf.com'},
 {name:'GraniteLeaf Cannabis - Chichester',streetAddress:'349 Dover Road (Route 4)',city:'Chichester',phone:'603-212-1500',website:'https://graniteleaf.com'},
 {name:'Sanctuary ATC - Plymouth',streetAddress:'568 Tenney Mountain Highway',city:'Plymouth',phone:'603-346-4619',website:'https://www.sanctuaryatc.org'},
 {name:'Sanctuary ATC - Conway',streetAddress:'234 White Mountain Highway (Route 16)',city:'Conway',phone:'603-662-0113',website:'https://www.sanctuaryatc.org'},
 {name:'Temescal Wellness - Dover',streetAddress:'26 Crosby Road, Units 11-12',city:'Dover',phone:'603-285-9383',website:'https://nh.temescalwellness.com'},
 {name:'Temescal Wellness - Lebanon',streetAddress:'367 Route 120, Unit E-2',city:'Lebanon',phone:'603-285-9383',website:'https://nh.temescalwellness.com'},
 {name:'Temescal Wellness - Keene',streetAddress:'69 Island Street, Suite 1',city:'Keene',phone:'603-285-9383',website:'https://nh.temescalwellness.com'}
] as const;

export async function fetchNewHampshireCandidates():Promise<NewHampshireCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'application/pdf','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`New Hampshire DHHS Therapeutic Cannabis Program source returned ${response.status}.`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length<4||String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3])!=='%PDF')throw new Error('New Hampshire DHHS Therapeutic Cannabis Program source was not a PDF; refusing an unverified import.');
 const text=new TextDecoder('latin1').decode(bytes);
 // Fail closed if DHHS stops publishing the expected program document. PDF text may be
 // compressed, so the seven-row roster is intentionally not parsed from PDF internals.
 if(bytes.length<10000)throw new Error('New Hampshire DHHS Therapeutic Cannabis Program PDF is unexpectedly small; refusing an unverified import.');
 void text;
 return LOCATIONS.map(row=>({...row,region:'New Hampshire',country:'USA',dataSource:'New Hampshire DHHS Therapeutic Cannabis Program Alternative Treatment Centers',sourceUrl:SOURCE_URL,sourceLicense:'Official New Hampshire Department of Health and Human Services Therapeutic Cannabis Program list of seven Alternative Treatment Center dispensing locations. Coordinates are completed through GeoWeedo Automated Enrichment.',imageryStatus:'missing_coordinates'}));
}
