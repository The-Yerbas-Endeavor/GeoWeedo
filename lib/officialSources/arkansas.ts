import 'server-only';
import { PDFParse } from 'pdf-parse';

type Row={name:string;streetAddress?:string;city?:string;region:string;country:string;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};
const SOURCE='https://www.dfa.arkansas.gov/wp-content/uploads/MMC_Agenda05152025.pdf';

function clean(value:string){return value.replace(/\s+/g,' ').replace(/^[a-e]\.\s*/i,'').trim();}
function cityHint(permit:string,name:string){
 const explicit=name.match(/\b(West Memphis|Morrilton|Clarksville|Van Buren|Little Rock|Hensley|Helena|Monticello|Texarkana)\b/i)?.[1];
 if(explicit)return explicit.replace(/\b\w/g,c=>c.toUpperCase());
 if(permit==='126')return 'Little Rock';
 return undefined;
}

export async function fetchArkansasCandidates():Promise<Row[]>{
 const response=await fetch(SOURCE,{headers:{Accept:'application/pdf','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw new Error(`Arkansas MMC dispensary-renewal agenda returned ${response.status}.`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length<4||String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3])!=='%PDF')throw new Error('Arkansas MMC dispensary-renewal download was not a PDF; refusing an unverified import.');
 const parser=new PDFParse({data:bytes});let text='';try{text=(await parser.getText()).text||'';}finally{await parser.destroy();}
 const normalized=text.replace(/\r/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n');
 const section=normalized.match(/C\.\s*Dispensary Renewals([\s\S]*?)(?:\b9\.\s*Cultivators\b|\bCultivators\b)/i)?.[1]||'';
 if(!section)throw new Error('Arkansas MMC agenda no longer contains the Dispensary Renewals section; refusing an unverified import.');
 const rows:Row[]=[];
 const re=/[a-e]\.\s*(\d{1,3})\.\s*([\s\S]*?)(?=\s+[a-e]\.\s*\d{1,3}\.|\s+\d+\.\s*Zone\s+\d+\s+Dispensaries|$)/gi;
 let match:RegExpExecArray|null;
 while((match=re.exec(section))!==null){
  const permit=match[1],name=clean(match[2]);
  if(!name||/cultivator|processor/i.test(name))continue;
  rows.push({name,city:cityHint(permit,name),region:'Arkansas',country:'USA',licenseNumber:`AR-MMC-${permit}`,dataSource:'Arkansas MMC Dispensary Renewals',sourceUrl:SOURCE,sourceLicense:'Official Arkansas Medical Marijuana Commission May 15, 2025 dispensary-renewal agenda; renewed dispensary permits only. Addresses and coordinates are intentionally left for GeoWeedo Automated Enrichment when not published in the renewal agenda.',imageryStatus:'missing_coordinates'});
 }
 const unique=new Map<string,Row>();for(const row of rows)if(row.licenseNumber&&!unique.has(row.licenseNumber))unique.set(row.licenseNumber,row);
 const result=Array.from(unique.values());
 if(result.length<30)throw new Error(`Arkansas MMC renewal agenda yielded only ${result.length} recognizable dispensary permits; refusing a likely partial import.`);
 return result;
}
