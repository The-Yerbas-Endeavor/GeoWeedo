import 'server-only';
import { PDFParse } from 'pdf-parse';

type IllinoisCandidate = {
  name: string;
  streetAddress?: string;
  city?: string;
  region: string;
  country: string;
  latitude?: number;
  longitude?: number;
  website?: string;
  licenseNumber?: string;
  dataSource: string;
  sourceUrl: string;
  sourceLicense: string;
  imageryStatus: 'unchecked' | 'missing_coordinates';
};

const SOURCE_URL='https://idfpr.illinois.gov/content/dam/soi/en/web/idfpr/licenselookup/adultusedispensaries.pdf';
const SOURCE_PAGE='https://idfpr.illinois.gov/profs/adultusecan/infoconsumers.html';

function clean(value:unknown){return String(value??'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,'\n').trim();}
function normalizeName(value:string){return clean(value).replace(/\s+/g,' ').trim();}
function unique(rows:IllinoisCandidate[]){const map=new Map<string,IllinoisCandidate>();for(const row of rows){const id=row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`.toLowerCase();if(!map.has(id))map.set(id,row);}return Array.from(map.values());}

function parseAddressCell(value:string){
  const lines=clean(value).split(/\n+/).map(v=>v.trim()).filter(Boolean).filter(v=>!/^\(?\d{3}\)?[-\s]\d{3}[-\s]\d{4}$/.test(v));
  const cityIndex=lines.findIndex(v=>/,\s*IL\s+\d{5}(?:-\d{4})?\b/i.test(v));
  if(cityIndex<0)return {streetAddress:lines.join(' ')||undefined,city:undefined};
  const cityLine=lines[cityIndex];
  const match=cityLine.match(/^(.+?),\s*IL\s+\d{5}(?:-\d{4})?\b/i);
  const city=match?.[1]?.trim();
  const streetAddress=lines.slice(0,cityIndex).join(' ').trim()||undefined;
  return {streetAddress,city};
}

function candidateFromTableRow(row:unknown[]):IllinoisCandidate|null{
  const cells=row.map(clean).filter((value,index,array)=>value||index<array.length);
  if(cells.length<5)return null;
  const licenseHolder=cells[0];
  const dispensaryName=cells[1];
  const addressCell=cells[2];
  const credential=cells[cells.length-1].match(/284\.\d{6}-AUDO/i)?.[0];
  if(!credential||/license holder/i.test(licenseHolder)||/dispensary name/i.test(dispensaryName))return null;
  const {streetAddress,city}=parseAddressCell(addressCell);
  const name=normalizeName(dispensaryName)||normalizeName(licenseHolder);
  if(!name||!city||!streetAddress)return null;
  return {name,streetAddress,city,region:'Illinois',country:'USA',licenseNumber:credential.toUpperCase(),dataSource:'Illinois IDFPR Licensed Adult Use Cannabis Dispensaries',sourceUrl:SOURCE_PAGE,sourceLicense:'Official Illinois Department of Financial and Professional Regulation adult-use dispensary license list.',imageryStatus:'missing_coordinates'};
}

function fallbackFromText(text:string):IllinoisCandidate[]{
  const rows:IllinoisCandidate[]=[];
  const chunks=text.split(/(?=\b284\.\d{6}-AUDO\b)/i);
  let carry='';
  for(const raw of chunks){
    const block=(carry+' '+raw).replace(/\s+/g,' ').trim();
    const credentialMatch=block.match(/284\.\d{6}-AUDO/i);
    if(!credentialMatch){carry=block.slice(-800);continue;}
    const before=block.slice(0,credentialMatch.index).trim();
    const cityMatches=Array.from(before.matchAll(/([A-Za-z][A-Za-z .'-]{1,50}),\s*IL\s+(\d{5}(?:-\d{4})?)/gi));
    const cityMatch=cityMatches.at(-1);
    const dateMatches=Array.from(before.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g));
    if(!cityMatch||!dateMatches.length){carry=raw.slice(-800);continue;}
    const city=cityMatch[1].trim();
    const cityStart=cityMatch.index??0;
    const prefix=before.slice(Math.max(0,cityStart-500),cityStart).replace(/\(?\d{3}\)?[-\s]\d{3}[-\s]\d{4}/g,' ').trim();
    const addressMatch=prefix.match(/(\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9 .#'&/-]{2,120})$/);
    const streetAddress=addressMatch?.[1]?.trim();
    const names=streetAddress?prefix.slice(0,prefix.length-streetAddress.length).trim():'';
    const name=names.split(/\s{2,}|\|/).map(v=>v.trim()).filter(Boolean).at(-1)||names;
    if(name&&streetAddress&&city)rows.push({name:normalizeName(name),streetAddress,city,region:'Illinois',country:'USA',licenseNumber:credentialMatch[0].toUpperCase(),dataSource:'Illinois IDFPR Licensed Adult Use Cannabis Dispensaries',sourceUrl:SOURCE_PAGE,sourceLicense:'Official Illinois Department of Financial and Professional Regulation adult-use dispensary license list.',imageryStatus:'missing_coordinates'});
    carry=raw.slice(-800);
  }
  return unique(rows);
}

export async function fetchIllinoisCandidates():Promise<IllinoisCandidate[]>{
  let response:Response;
  try{response=await fetch(SOURCE_URL,{headers:{Accept:'application/pdf','User-Agent':'GeoWeedo/0.5 (https://geoweedo.yerbas.org)'},cache:'no-store',signal:AbortSignal.timeout(30000)});}catch(error){throw new Error(`Illinois IDFPR connection failed: ${error instanceof Error?error.message:String(error)}`);}
  if(!response.ok)throw new Error(`Illinois IDFPR returned ${response.status}.`);
  const buffer=Buffer.from(await response.arrayBuffer());
  if(buffer.length<1000)throw new Error('Illinois IDFPR returned an unexpectedly small PDF.');
  if(buffer.length>25*1024*1024)throw new Error('Illinois IDFPR PDF exceeded the 25 MB safety limit.');
  const parser=new PDFParse({data:buffer});
  try{
    const tableResult=await parser.getTable();
    const tableRows:IllinoisCandidate[]=[];
    for(const page of tableResult.pages||[])for(const table of page.tables||[])for(const row of table||[]){const parsed=candidateFromTableRow(row as unknown[]);if(parsed)tableRows.push(parsed);}
    const deduped=unique(tableRows);
    if(deduped.length>=50)return deduped;
    const textResult=await parser.getText();
    const fallback=fallbackFromText(textResult.text||'');
    if(fallback.length>=50)return fallback;
    throw new Error(`Illinois IDFPR PDF parser found only ${Math.max(deduped.length,fallback.length)} valid dispensary rows; refusing a partial import.`);
  }finally{await parser.destroy();}
}
