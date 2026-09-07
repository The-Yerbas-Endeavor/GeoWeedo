export type AlabamaCandidate={name:string;streetAddress?:string;city?:string;region:string;country:string;website?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://amcc.alabama.gov/patients/';

function decode(value:string){return value.replace(/&amp;/gi,'&').replace(/&#0*39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));}
function text(value:string){return decode(value.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());}

export async function fetchAlabamaCandidates():Promise<AlabamaCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Alabama AMCC patient/dispensary page returned ${response.status}`);
 const html=await response.text();
 const start=html.search(/Dispensary Opening Announcements/i);
 if(start<0)throw new Error('Alabama AMCC page no longer contains the Dispensary Opening Announcements section; refusing a potentially incorrect import.');
 const endCandidates=[html.indexOf('Patient, Caregiver, and Physician Registration',start),html.indexOf('Patient &amp; Caregiver',start),html.indexOf('Patient & Caregiver',start)].filter(i=>i>start);
 const section=html.slice(start,endCandidates.length?Math.min(...endCandidates):Math.min(html.length,start+60000));
 const plain=text(section);
 const rows:AlabamaCandidate[]=[];
 const opening=/OPENING\s+([A-Z]+\s+\d{1,2},\s+20\d{2})\s+(.+?)\s+(\d{1,6}\s+.+?)\s+([A-Za-z .'-]+),\s*AL\s+\d{5}(?:-\d{4})?/gi;
 let match:RegExpExecArray|null;
 while((match=opening.exec(plain))!==null){
   const name=match[2].trim().replace(/\s+/g,' ');
   const streetAddress=match[3].trim().replace(/\s+/g,' ');
   const city=match[4].trim().replace(/\s+/g,' ');
   if(!name||!streetAddress||!city)continue;
   rows.push({name,streetAddress,city,region:'Alabama',country:'USA',dataSource:'Alabama AMCC Dispensary Opening Announcements',sourceUrl:SOURCE_URL,sourceLicense:'Official Alabama Medical Cannabis Commission operational dispensary opening announcements; only locations with a published opening date and street address are imported.',imageryStatus:'missing_coordinates'});
 }
 const unique=[...new Map(rows.map(row=>[`${row.name.toLowerCase()}|${row.streetAddress?.toLowerCase()}`,row])).values()];
 if(!unique.length)throw new Error('Alabama AMCC page returned no operational dispensary opening records; refusing to import proposed or merely licensed future sites.');
 return unique;
}
