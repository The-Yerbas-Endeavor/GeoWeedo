import 'server-only';

type LouisianaCandidate={name:string;streetAddress?:string;city?:string;region:string;country:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://ldh.la.gov/page/medical-marijuana';

function decodeHtml(value:string){return value.replace(/<br\s*\/?\s*>/gi,'\n').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#0*39;|&apos;/gi,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function clean(value:string){return decodeHtml(value).replace(/\s+,/g,',').trim();}
function parseCity(address:string){const match=address.match(/,\s*([^,]+),\s*LA\s+\d{5}(?:-\d{4})?\b/i);return match?clean(match[1]):undefined;}
function parseStreet(address:string){return clean(address.replace(/,\s*[^,]+,\s*LA\s+\d{5}(?:-\d{4})?\b.*$/i,''));}

export async function fetchLouisianaCandidates():Promise<LouisianaCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Louisiana LDH medical-marijuana page returned ${response.status}.`);
 const html=await response.text();
 const rows:LouisianaCandidate[]=[];
 const tr=/<tr[^>]*>([\s\S]*?)<\/tr>/gi;
 let match:RegExpExecArray|null;
 while((match=tr.exec(html))!==null){
  const cells:string[]=[];
  const td=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let cell:RegExpExecArray|null;
  while((cell=td.exec(match[1]))!==null)cells.push(clean(cell[1]));
  if(cells.length<3)continue;
  if(/region/i.test(cells[0])&&/name/i.test(cells[1]))continue;
  const name=cells[1]||'';
  const address=cells[2]||'';
  if(!name||!/\bLA\s+\d{5}\b/i.test(address))continue;
  const city=parseCity(address),streetAddress=parseStreet(address);
  if(!city||!streetAddress)continue;
  rows.push({name,streetAddress,city,region:'Louisiana',country:'USA',dataSource:'Louisiana LDH Medical Marijuana Retailers',sourceUrl:SOURCE_URL,sourceLicense:'Official Louisiana Department of Health medical-marijuana retailer table; includes base permits and satellite dispensing locations currently published by LDH.',imageryStatus:'missing_coordinates'});
 }
 const unique=new Map<string,LouisianaCandidate>();
 for(const row of rows){const key=`${row.name}|${row.streetAddress}|${row.city}`.toLowerCase().replace(/[^a-z0-9|]/g,'');if(!unique.has(key))unique.set(key,row);}
 const result=Array.from(unique.values());
 if(result.length<25)throw new Error(`Louisiana LDH page yielded only ${result.length} recognizable retailer locations; refusing a likely partial import.`);
 return result;
}
