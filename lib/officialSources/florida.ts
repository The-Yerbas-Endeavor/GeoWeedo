import 'server-only';

export type FloridaCandidate={name:string;streetAddress?:string;city?:string;region:string;country:string;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://knowthefactsmmj.com/mmtc/';
function clean(value:string){return value.replace(/<[^>]+>/g,' ').replace(/&amp;/gi,'&').replace(/&#0*39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();}

export async function fetchFloridaCandidates():Promise<FloridaCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw new Error(`Florida OMMU MMTC page returned ${response.status}.`);
 const html=await response.text();
 const rows:FloridaCandidate[]=[];
 const tr=/<tr[^>]*>([\s\S]*?)<\/tr>/gi;let match:RegExpExecArray|null;
 while((match=tr.exec(html))!==null){
  const cells:string[]=[];const td=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;let cell:RegExpExecArray|null;
  while((cell=td.exec(match[1]))!==null)cells.push(clean(cell[1]));
  if(cells.length<5)continue;
  const lower=cells.map(v=>v.toLowerCase());
  if(lower.some(v=>v==='company'||v==='address'||v==='city'||v==='zip code'||v==='county'))continue;
  const name=cells[0],streetAddress=cells[1];
  // Current OMMU dispensing-location table is COMPANY, ADDRESS, EMAIL ADDRESS, PHONE, CITY, ZIP CODE, COUNTY.
  const city=cells.length>=7?cells[4]:cells[cells.length-3];
  const zip=cells.length>=7?cells[5]:cells[cells.length-2];
  if(!name||!streetAddress||!/\d/.test(streetAddress)||!/^\d{5}(?:-\d{4})?$/.test(zip))continue;
  rows.push({name,streetAddress,city,region:'Florida',country:'USA',dataSource:'Florida OMMU MMTC Dispensing Locations',sourceUrl:SOURCE_URL,sourceLicense:'Official Florida Department of Health Office of Medical Marijuana Use public MMTC dispensing-location list; approved dispensing locations only.',imageryStatus:'missing_coordinates'});
 }
 const unique=new Map<string,FloridaCandidate>();
 for(const row of rows){const key=`${row.name}|${row.streetAddress}|${row.city}`.toLowerCase().replace(/[^a-z0-9|]/g,'');if(!unique.has(key))unique.set(key,row);}
 const result=Array.from(unique.values());
 if(result.length<100)throw new Error(`Florida OMMU page yielded only ${result.length} recognizable dispensing locations; refusing a likely partial import.`);
 return result;
}
