import 'server-only';
import { PDFParse } from 'pdf-parse';

type PennsylvaniaCandidate={name:string;streetAddress:string;city:string;region:string;country:string;phone?:string;website?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://www.pa.gov/content/dam/copapwp-pagov/en/health/documents/topics/documents/programs/medical-marijuana/Medical%20Marijuana%20Dispensaries%20in%20Pennsylvania%20with%20Product.pdf';

function clean(value:string){return value.replace(/\s+/g,' ').trim();}
function normalizeWebsite(value:string){const v=clean(value).replace(/[),.;]+$/,'');if(!v)return undefined;return /^https?:\/\//i.test(v)?v:`https://${v}`;}

export async function fetchPennsylvaniaCandidates():Promise<PennsylvaniaCandidate[]>{
 const response=await fetch(SOURCE_URL,{headers:{Accept:'application/pdf','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw new Error(`Pennsylvania DOH dispensary PDF returned ${response.status}.`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length<4||String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3])!=='%PDF')throw new Error('Pennsylvania DOH dispensary download was not a PDF; refusing an unverified import.');
 const parser=new PDFParse({data:bytes});let text='';try{text=(await parser.getText()).text||'';}finally{await parser.destroy();}
 const normalized=text.replace(/\r/g,'\n').replace(/[ \t]+/g,' ').replace(/\n+/g,' ');
 const rows:PennsylvaniaCandidate[]=[];
 const re=/(?:\d{1,2}\/\d{1,2}\/\d{2,4}\s+){2}(?:Yes|No)\s+(.+?)\s+(\d{1,6}\s+.+?)\s+([A-Za-z][A-Za-z .'-]{1,60})\s+Pennsylvania\s+(\d{5})(?:-\d{4})?\s+(\d{3}[-. ]\d{3}[-. ]\d{4})\s+((?:https?:\/\/|www\.)\S+)/gi;
 let match:RegExpExecArray|null;
 while((match=re.exec(normalized))!==null){
  const name=clean(match[1]),streetAddress=clean(match[2]),city=clean(match[3]),phone=clean(match[5]),website=normalizeWebsite(match[6]);
  if(!name||!streetAddress||!city)continue;
  rows.push({name,streetAddress,city,region:'Pennsylvania',country:'USA',phone,website,dataSource:'Pennsylvania DOH Medical Marijuana Dispensaries with Product',sourceUrl:SOURCE_URL,sourceLicense:'Official Pennsylvania Department of Health Medical Marijuana Program dispensary-location list. Open dispensary locations published by DOH; coordinates are completed through GeoWeedo Automated Enrichment.',imageryStatus:'missing_coordinates'});
 }
 const unique=new Map<string,PennsylvaniaCandidate>();
 for(const row of rows){const key=`${row.name}|${row.streetAddress}|${row.city}`.toLowerCase().replace(/[^a-z0-9|]/g,'');if(!unique.has(key))unique.set(key,row);}
 const result=Array.from(unique.values());
 if(result.length<100)throw new Error(`Pennsylvania DOH dispensary PDF yielded only ${result.length} recognizable locations; refusing a likely partial or markup-mismatched import.`);
 return result;
}
