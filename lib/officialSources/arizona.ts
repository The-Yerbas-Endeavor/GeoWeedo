import 'server-only';
import { PDFParse } from 'pdf-parse';

export type ArizonaCandidate={name:string;streetAddress?:string;city?:string;region:string;country:string;latitude?:number;longitude?:number;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'unchecked'|'missing_coordinates'};

const SOURCE_URL='https://www.azdhs.gov/documents/licensing/medical-marijuana/applications/licensed-marijuana-establishments.pdf';

function clean(value:string){return value.replace(/\s+/g,' ').trim();}
function isStreet(value:string){return /^\d{1,6}\s+.+\b(?:st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|hwy|highway|ln|lane|way|pkwy|parkway|pl|place|ct|court|trl|trail|cir|circle)\b/i.test(value);}

export async function fetchArizonaCandidates():Promise<ArizonaCandidate[]>{
  const response=await fetch(SOURCE_URL,{headers:{Accept:'application/pdf','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error(`Arizona ADHS licensed-establishments report returned ${response.status}.`);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length<4||String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3])!=='%PDF')throw new Error('Arizona ADHS licensed-establishments download was not a PDF; refusing an unverified import.');
  const parser=new PDFParse({data:bytes});
  let text='';
  try{text=(await parser.getText()).text||'';}finally{await parser.destroy();}
  const normalized=text.replace(/\r/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n');
  const licenseRe=/\b\d{8}ES[A-Z]{2}\d{8}\b/g;
  const licenses:Array<{license:string;index:number}>=[];
  let licenseMatch:RegExpExecArray|null;
  while((licenseMatch=licenseRe.exec(normalized))!==null)licenses.push({license:licenseMatch[0],index:licenseMatch.index});
  const rows:ArizonaCandidate[]=[];
  for(let i=0;i<licenses.length;i++){
    const current=licenses[i],next=licenses[i+1];
    const prefix=clean(normalized.slice(Math.max(0,current.index-60),current.index));
    if(!/\bOpen\b/i.test(prefix)||/Not Operating/i.test(prefix))continue;
    const end=next?next.index:Math.min(normalized.length,current.index+700);
    const after=clean(normalized.slice(current.index+current.license.length,end));
    const zip=after.match(/\b([A-Za-z .'-]{2,40})\s+(85\d{3})\b/);
    if(!zip)continue;
    const city=clean(zip[1]);
    const beforeCity=clean(after.slice(0,zip.index));
    const streetRe=/\b\d{1,6}\s+[^|]{3,120}/g;
    const streets:string[]=[];
    let streetMatch:RegExpExecArray|null;
    while((streetMatch=streetRe.exec(beforeCity))!==null){const value=clean(streetMatch[0]);if(isStreet(value))streets.push(value);}
    const streetAddress=streets.length?streets[streets.length-1]:undefined;
    if(!streetAddress)continue;
    const cut=beforeCity.lastIndexOf(streetAddress);
    let name=clean(cut>=0?beforeCity.slice(0,cut):beforeCity);
    name=name.replace(/^Open\s+/i,'').trim();
    if(!name||name.length<2)continue;
    if(name.length>120)name=name.slice(0,120).trim();
    rows.push({name,streetAddress,city,region:'Arizona',country:'USA',licenseNumber:current.license,dataSource:'Arizona ADHS Licensed Marijuana Establishments',sourceUrl:SOURCE_URL,sourceLicense:'Official Arizona Department of Health Services Adult Use Marijuana Program licensed-establishments report; Open establishments only. This official snapshot is used because the current ADHS public provider search does not expose a complete machine-readable marijuana-only roster.',imageryStatus:'missing_coordinates'});
  }
  const unique=new Map<string,ArizonaCandidate>();
  for(const row of rows)if(row.licenseNumber&&!unique.has(row.licenseNumber))unique.set(row.licenseNumber,row);
  const result=Array.from(unique.values());
  if(result.length<25)throw new Error(`Arizona ADHS report yielded only ${result.length} recognizable open establishments; refusing a likely partial import.`);
  return result;
}
