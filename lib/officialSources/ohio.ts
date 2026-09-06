import 'server-only';
import { PDFParse } from 'pdf-parse';

type Row={name:string;streetAddress?:string;city?:string;region:string;country:string;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};
const SOURCE='https://dam.assets.ohio.gov/image/upload/com.ohio.gov/DCC/Guidance/Dispensaries/10_B_Facility_Site_Location_Application_Instructions.pdf';
function clean(v:string){return v.replace(/\s+/g,' ').trim();}

export async function fetchOhioCandidates():Promise<Row[]>{
 const response=await fetch(SOURCE,{headers:{Accept:'application/pdf','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw new Error(`Ohio DCC dispensary report returned ${response.status}.`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length<4||String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3])!=='%PDF')throw new Error('Ohio DCC dispensary report was not a PDF; refusing an unverified import.');
 const parser=new PDFParse({data:bytes});let text='';try{text=(await parser.getText()).text||'';}finally{await parser.destroy();}
 const normalized=text.replace(/\r/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n');
 const section=normalized.match(/APPENDIX D\s+OTHER DISPENSARIES([\s\S]*?)(?:APPENDIX E|$)/i)?.[1]||'';
 if(!section)throw new Error('Ohio DCC report no longer contains Appendix D Other Dispensaries; refusing an unverified import.');
 const rows:Row[]=[];
 const re=/\b(MMDP?\.\d{4,7})\b\s+([^\n]{2,120}?)\s+(\d{1,6}\s+[^\n]{2,100}?)\s+([A-Za-z][A-Za-z .'-]{1,40})\s+(\d{5})\b/g;
 let m:RegExpExecArray|null;while((m=re.exec(section))!==null){rows.push({licenseNumber:m[1],name:clean(m[2]),streetAddress:clean(m[3]),city:clean(m[4]),region:'Ohio',country:'USA',dataSource:'Ohio DCC Dispensary Licensing',sourceUrl:SOURCE,sourceLicense:'Official Ohio Division of Cannabis Control dispensary guidance Appendix D; dispensaries with a provisional license or Certificate of Operation.',imageryStatus:'missing_coordinates'});}
 const unique=new Map<string,Row>();for(const row of rows)if(!unique.has(row.licenseNumber!))unique.set(row.licenseNumber!,row);
 const result=Array.from(unique.values());if(result.length<25)throw new Error(`Ohio DCC report yielded only ${result.length} recognizable licensed/provisional dispensaries; refusing a likely partial import.`);return result;
}
