import 'server-only';
import { PDFParse } from 'pdf-parse';

type Row={name:string;streetAddress?:string;city?:string;region:string;country:string;latitude?:number;longitude?:number;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'unchecked'|'missing_coordinates'};

const SOURCE='https://dam.assets.ohio.gov/image/upload/com.ohio.gov/DCC/Guidance/Dispensaries/10_B_Facility_Site_Location_Application_Instructions.pdf';

function clean(v:string){return v.replace(/\s+/g,' ').trim();}
function readiness(latitude?:number,longitude?:number){return Number.isFinite(latitude)&&Number.isFinite(longitude)?'unchecked' as const:'missing_coordinates' as const;}

export async function fetchOhioCandidates():Promise<Row[]>{
 const response=await fetch(SOURCE,{headers:{Accept:'application/pdf','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)','Accept-Language':'en-US,en;q=0.9'},cache:'no-store',signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw new Error(`Ohio DCC dispensary report returned ${response.status}.`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length<4||String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3])!=='%PDF')throw new Error('Ohio DCC dispensary report was not a PDF; refusing an unverified import.');
 const parser=new PDFParse({data:bytes});let text='';try{text=(await parser.getText()).text||'';}finally{await parser.destroy();}
 const normalized=text.replace(/\r/g,'\n').replace(/[ \t]+/g,' ').replace(/\n+/g,' ');
 const appendixC=normalized.match(/APPENDIX C\s+EXISTING DISPENSARIES([\s\S]*?)(?:APPENDIX D|$)/i)?.[1]||'';
 const appendixD=normalized.match(/APPENDIX D\s+OTHER DISPENSARIES([\s\S]*?)(?:APPENDIX E|$)/i)?.[1]||'';
 if(!appendixC||!appendixD)throw new Error('Ohio DCC report no longer contains recognizable Appendix C and Appendix D dispensary sections; refusing an unverified import.');

 const rows:Row[]=[];
 const existing=/\b(MMDP?\.\d{4,7})\b\s+(.+?)\s+(\d{1,6}\s+.+?)\s+(-8\d\.\d+)\s+((?:3[8-9]|4[0-2])\.\d+)\s+([A-Za-z][A-Za-z .'-]{1,50})\s+(\d{5})\b/g;
 let match:RegExpExecArray|null;
 while((match=existing.exec(appendixC))!==null){
  const longitude=Number(match[4]),latitude=Number(match[5]);
  rows.push({licenseNumber:match[1],name:clean(match[2]),streetAddress:clean(match[3]),city:clean(match[6]),region:'Ohio',country:'USA',latitude,longitude,dataSource:'Ohio DCC Existing Dispensaries',sourceUrl:SOURCE,sourceLicense:'Official Ohio Division of Cannabis Control Appendix C existing dispensary list. The state publishes license number, business name, street address, coordinates, city, and ZIP for these locations.',imageryStatus:readiness(latitude,longitude)});
 }
 const existingCount=rows.length;

 const other=/\b(MMDP?\.\d{4,7})\b\s+(.+?)\s+((?:\d{1,6}|Parcel\b)\s+.+?)\s+([A-Za-z][A-Za-z .'-]{1,50})\s+(\d{5})\b/g;
 while((match=other.exec(appendixD))!==null){
  rows.push({licenseNumber:match[1],name:clean(match[2]),streetAddress:clean(match[3]),city:clean(match[4]),region:'Ohio',country:'USA',dataSource:'Ohio DCC Other Licensed Dispensaries',sourceUrl:SOURCE,sourceLicense:'Official Ohio Division of Cannabis Control Appendix D dispensary list; locations with a provisional license or Certificate of Operation that are not subject to the one-mile buffer. Coordinates are completed through GeoWeedo Automated Enrichment.',imageryStatus:'missing_coordinates'});
 }
 const otherCount=rows.length-existingCount;

 const unique=new Map<string,Row>();
 for(const row of rows){const key=row.licenseNumber?.toLowerCase()||`${row.name}|${row.streetAddress}`.toLowerCase();if(!unique.has(key))unique.set(key,row);}
 const result=Array.from(unique.values());
 if(existingCount<100)throw new Error(`Ohio DCC Appendix C yielded only ${existingCount} recognizable existing dispensaries; refusing a likely partial or PDF-layout-mismatched import.`);
 if(otherCount<10)throw new Error(`Ohio DCC Appendix D yielded only ${otherCount} recognizable additional licensed/provisional dispensaries; refusing a likely partial or PDF-layout-mismatched import.`);
 if(result.length<120)throw new Error(`Ohio DCC report yielded only ${result.length} unique dispensaries across Appendices C and D; refusing a likely partial import.`);
 return result;
}
