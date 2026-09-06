import 'server-only';

type GeorgiaCandidate={name:string;city:string;region:string;country:string;licenseNumber:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://www.gmcc.ga.gov/licensing/verify-a-license';

// Georgia GMCC's Verify a License page publishes the currently active dispensing
// licenses. The Commission's separate dispensary map says locations are added when
// a licensed dispensary begins operations. We preserve license number, DBA/name and
// city here; street address and coordinates are completed by Automated Enrichment.
const LOCATIONS=[
 {licenseNumber:'DISP0001',name:'Trulieve Medical Cannabis Dispensary of Macon',city:'Macon'},
 {licenseNumber:'DISP0002',name:'Trulieve Medical Cannabis Dispensary of Marietta',city:'Marietta'},
 {licenseNumber:'DISP0003',name:'Trulieve Medical Cannabis Dispensary of Pooler',city:'Pooler'},
 {licenseNumber:'DISP0004',name:'Botanical Sciences',city:'Marietta'},
 {licenseNumber:'DISP0005',name:'Botanical Sciences',city:'Pooler'},
 {licenseNumber:'DISP0006',name:'Trulieve Medical Cannabis Dispensary of Newnan',city:'Newnan'},
 {licenseNumber:'DISP0007',name:'Botanical Sciences',city:'Chamblee'},
 {licenseNumber:'DISP0008',name:'Botanical Sciences',city:'Stockbridge'},
 {licenseNumber:'DISP0009',name:'Trulieve Medical Cannabis Dispensary of Evans',city:'Evans'},
 {licenseNumber:'DISP0011',name:'Fine Fettle',city:'Smyrna'},
 {licenseNumber:'DISP0012',name:'FFD GA Athens LLC',city:'Athens'},
 {licenseNumber:'DISP0013',name:'Fine Fettle',city:'Decatur'},
 {licenseNumber:'DISP0014',name:'Trulieve Medical Cannabis Dispensary of Columbus',city:'Columbus'},
 {licenseNumber:'DISP0015',name:'Treevana Remedy Inc.',city:'Milledgeville'},
 {licenseNumber:'DISP0017',name:'True Bliss Dispensary',city:'Atlanta'},
 {licenseNumber:'DISP0018',name:'Botanical Sciences',city:'Atlanta'},
 {licenseNumber:'DISP0019',name:'True Bliss Dispensary',city:'Atlanta'},
 {licenseNumber:'DISP0020',name:'FFD GA Evans LLC',city:'Evans'},
 {licenseNumber:'DISP0021',name:'Trulieve Medical Cannabis Dispensary of Dunwoody',city:'Dunwoody'}
] as const;

export async function fetchGeorgiaCandidates():Promise<GeorgiaCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Georgia GMCC Verify a License source returned ${response.status}.`);
 const html=await response.text();
 const plain=html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
 const activeLicenses=Array.from(plain.matchAll(/DISP\s*0*(\d{1,4})[\s\S]{0,180}?ACTIVE/gi),m=>`DISP${String(Number(m[1])).padStart(4,'0')}`);
 const unique=new Set(activeLicenses);
 if(unique.size<15)throw new Error(`Georgia GMCC source yielded only ${unique.size} recognizable active dispensing licenses; refusing a likely partial import.`);
 const missing=LOCATIONS.filter(row=>!unique.has(row.licenseNumber));
 if(missing.length>3)throw new Error(`Georgia GMCC source no longer confirms ${missing.length} expected active dispensing licenses; refusing an unverified import.`);
 return LOCATIONS.filter(row=>unique.has(row.licenseNumber)).map(row=>({...row,region:'Georgia',country:'USA',dataSource:'Georgia Access to Medical Cannabis Commission - Active Dispensing Licenses',sourceUrl:SOURCE_URL,sourceLicense:'Official Georgia Access to Medical Cannabis Commission Verify a License roster; ACTIVE dispensing licenses only. The GMCC dispensary map is maintained as locations begin operations. Street addresses and coordinates are completed through GeoWeedo Automated Enrichment.',imageryStatus:'missing_coordinates'}));
}
