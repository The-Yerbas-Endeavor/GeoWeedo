import 'server-only';

type TexasCandidate={name:string;region:string;country:string;website:string;licenseNumber:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://www.dps.texas.gov/section/compassionate-use-program/licensed-dispensaries';

// Texas DPS currently identifies three active TCUP dispensing organizations.
// DPS does not publish a storefront address on this roster, so GeoWeedo imports
// the official organization/license identity and completes location details
// through Automated Enrichment rather than guessing an address.
const ACTIVE_LICENSEES=[
 {name:'Fluent',licenseNumber:'0004',website:'https://getfluent.com/'},
 {name:'Texas Original',licenseNumber:'0005',website:'https://texasoriginal.com/'},
 {name:'Goodblend',licenseNumber:'0006',website:'https://tx.goodblend.com/support/'}
] as const;

function normalizePlain(html:string){
 return html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#0*39;|&apos;/g,"'").replace(/\s+/g,' ').trim();
}

export async function fetchTexasCandidates():Promise<TexasCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Texas DPS Licensed Dispensaries source returned ${response.status}.`);
 const plain=normalizePlain(await response.text());
 const expected=['Fluent','Texas Original','Goodblend','0004','0005','0006'];
 const missing=expected.filter(value=>!plain.toLowerCase().includes(value.toLowerCase()));
 if(missing.length)throw new Error(`Texas DPS licensed-dispensary page no longer confirms the expected three active TCUP licensees (${missing.join(', ')} missing); refusing an unverified import.`);
 if(!/3 current active licenses|current active licensed dispensaries/i.test(plain))throw new Error('Texas DPS page no longer confirms the active licensed-dispensary roster; refusing an unverified import.');
 return ACTIVE_LICENSEES.map(row=>({...row,region:'Texas',country:'USA',dataSource:'Texas DPS Compassionate Use Program - Licensed Dispensaries',sourceUrl:SOURCE_URL,sourceLicense:'Official Texas Department of Public Safety Compassionate Use Program active dispensing-organization roster. DPS currently publishes three active licensees but no storefront addresses on this page; address and coordinates are completed through GeoWeedo Automated Enrichment. Conditional 2026 expansion licensees are intentionally excluded until DPS identifies them as active.',imageryStatus:'missing_coordinates'}));
}
