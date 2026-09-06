import 'server-only';

type MississippiCandidate={name:string;streetAddress?:string;city?:string;region:string;country:string;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://www.mmcp.ms.gov/search_business';

function decode(value:string){return value.replace(/<br\s*\/?\s*>/gi,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#0*39;|&apos;/gi,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function parseAddress(value:string){
 const address=decode(value);
 const match=address.match(/^(.*?)\s+([A-Za-z][A-Za-z .'-]+),?\s+MS\s+(\d{5}(?:-\d{4})?)\b/i);
 if(!match)return{streetAddress:address||undefined,city:undefined};
 return{streetAddress:match[1].trim()||undefined,city:match[2].trim()||undefined};
}

export async function fetchMississippiCandidates():Promise<MississippiCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Mississippi MMCP Business Search returned ${response.status}.`);
 const html=await response.text();
 const rows:MississippiCandidate[]=[];
 const tr=/<tr[^>]*>([\s\S]*?)<\/tr>/gi;
 let match:RegExpExecArray|null;
 while((match=tr.exec(html))!==null){
  const cells:string[]=[];
  const td=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let cell:RegExpExecArray|null;
  while((cell=td.exec(match[1]))!==null)cells.push(decode(cell[1]));
  if(cells.length<8)continue;
  const licenseNumber=cells[0]||'';
  const name=cells[1]||'';
  const businessType=cells[2]||'';
  const physicalAddress=cells[7]||'';
  if(!/^DSPY/i.test(licenseNumber)&&!/\bdispensary\b/i.test(businessType))continue;
  if(!name)continue;
  const {streetAddress,city}=parseAddress(physicalAddress);
  rows.push({name,streetAddress,city,region:'Mississippi',country:'USA',licenseNumber:licenseNumber||undefined,dataSource:'Mississippi MMCP Business Search',sourceUrl:SOURCE_URL,sourceLicense:'Official Mississippi Medical Cannabis Program Business Search; registered establishments filtered to Dispensary licenses.',imageryStatus:'missing_coordinates'});
 }
 const unique=new Map<string,MississippiCandidate>();
 for(const row of rows){const key=(row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`).toLowerCase().replace(/[^a-z0-9|]/g,'');if(!unique.has(key))unique.set(key,row);}
 const result=Array.from(unique.values());
 if(result.length<50)throw new Error(`Mississippi MMCP Business Search yielded only ${result.length} recognizable dispensary records; refusing a likely partial or schema-mismatched import.`);
 return result;
}
