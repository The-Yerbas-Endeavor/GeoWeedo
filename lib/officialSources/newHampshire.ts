import 'server-only';

type NewHampshireCandidate={name:string;streetAddress:string;city:string;region:string;country:string;phone?:string;website?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://www.dhhs.nh.gov/sites/g/files/ehbemt476/files/documents/2021-11/tcp-infosheetpatient.pdf';

// NH DHHS publishes seven Alternative Treatment Center dispensing locations.
// The state CDN currently returns HTTP 403 to some server-to-server requests,
// including GeoWeedo production. Keep the small official roster explicitly in
// source control rather than failing the import solely because the CDN blocks us.
// The source URL remains attached to every candidate for provenance and review.
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
 if(LOCATIONS.length!==7)throw new Error(`New Hampshire DHHS embedded roster contains ${LOCATIONS.length} locations; expected 7, refusing an incomplete import.`);
 const seen=new Set<string>();
 for(const row of LOCATIONS){
  const key=`${row.name}|${row.streetAddress}|${row.city}`.toLowerCase();
  if(!row.name||!row.streetAddress||!row.city||seen.has(key))throw new Error('New Hampshire DHHS embedded roster failed integrity validation.');
  seen.add(key);
 }
 return LOCATIONS.map(row=>({...row,region:'New Hampshire',country:'USA',dataSource:'New Hampshire DHHS Therapeutic Cannabis Program Alternative Treatment Centers',sourceUrl:SOURCE_URL,sourceLicense:'Official New Hampshire Department of Health and Human Services Therapeutic Cannabis Program list of seven Alternative Treatment Center dispensing locations. The DHHS CDN may reject automated server requests with HTTP 403, so GeoWeedo keeps this small state-published roster explicitly with source provenance. Coordinates are completed through GeoWeedo Automated Enrichment.',imageryStatus:'missing_coordinates'}));
}
