import 'server-only';
import 'pdf-parse/worker';
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
const SOURCE_NAME='Illinois IDFPR Licensed Adult Use Cannabis Dispensaries';
const SOURCE_LICENSE='Official Illinois Department of Financial and Professional Regulation active adult-use dispensary license list.';
const CREDENTIAL_RE=/284\.\d{6,7}\s*(?:-|\.)\s*AUDO\b/i;
const STATE_ZIP_RE=/,\s*(?:IL|Illinois)\.?\s+(\d{5}(?:-\s*\d{4})?)\b/i;
const STREET_SUFFIX_RE=/\b(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Highway|Hwy|Lane|Ln|Court|Ct|Parkway|Pkwy|Place|Pl|Terrace|Ter|Circle|Cir)\.?\b/gi;

function clean(value:unknown){return String(value??'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,'\n').trim();}
function normalizeName(value:string){return clean(value).replace(/\s+/g,' ').replace(/^[-–—|]+|[-–—|]+$/g,'').trim();}
function normalizeCredential(value:string){return value.replace(/\s+/g,'').replace(/\.AUDO$/i,'-AUDO').toUpperCase();}
function unique(rows:IllinoisCandidate[]){const map=new Map<string,IllinoisCandidate>();for(const row of rows){const id=row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`.toLowerCase();if(!map.has(id))map.set(id,row);}return Array.from(map.values());}
function candidate(name:string,streetAddress:string,city:string,licenseNumber:string):IllinoisCandidate{return{name:normalizeName(name),streetAddress:clean(streetAddress),city:clean(city),region:'Illinois',country:'USA',licenseNumber:normalizeCredential(licenseNumber),dataSource:SOURCE_NAME,sourceUrl:SOURCE_PAGE,sourceLicense:SOURCE_LICENSE,imageryStatus:'missing_coordinates'};}
function header(value:string){return /^(?:Links to each document.*|Active Adult Use Dispensing Organization Licenses|Total Number of Active.*|Dispensaries highlighted.*|Dispensaries that are.*|License Holder|Dispensary Name|Address & Phone|Number$|License Issue|Date$|Adult Use Credential|idfpr\.illinois\.gov|JB PRITZKER|Governor|MARIO TRETO.*|Secretary|CAMILE LINDSAY|Director|\d+)$/i.test(value);}
function streetLike(value:string){return /^\d{1,6}[A-Za-z-]?\s+/.test(value)||/^\d+[A-Za-z]?\s*(?:N|S|E|W)\.?\s+/i.test(value);}
function stripPhones(value:string){return value.replace(/\(?\d{3}\)?\s*[-.]?\s*\d{3}\s*[-.]?\s*\d{4}/g,' ').replace(/\s+/g,' ').trim();}

function splitStreetAndCity(fragment:string):{streetAddress:string;city:string}|null{
  const state=STATE_ZIP_RE.exec(fragment);
  if(!state||state.index===undefined)return null;
  const beforeState=fragment.slice(0,state.index).trim();
  STREET_SUFFIX_RE.lastIndex=0;
  const suffixes=Array.from(beforeState.matchAll(STREET_SUFFIX_RE));
  const suffix=suffixes.at(-1);
  if(!suffix||suffix.index===undefined)return null;

  const suffixEnd=suffix.index+suffix[0].length;
  const baseStreet=beforeState.slice(0,suffixEnd).trim();
  let tail=beforeState.slice(suffixEnd).trim();
  if(!tail)return null;

  let unit='';
  const unitMatch=tail.match(/^((?:#\s*[A-Za-z0-9-]+|Ste\.?\s*[A-Za-z0-9-]+|Suite\s+[A-Za-z0-9-]+|Unit\s+[A-Za-z0-9-]+))\s+(.+)$/i);
  if(unitMatch){unit=unitMatch[1].trim();tail=unitMatch[2].trim();}

  const city=tail.replace(/,$/,'').trim();
  const streetAddress=`${baseStreet}${unit?` ${unit}`:''}`.trim();
  if(!streetAddress||!city||/\d{5}/.test(city))return null;
  return {streetAddress,city};
}

function parseRecord(record:string[],licenseNumber:string):IllinoisCandidate|null{
  const usable=record.map(v=>clean(v)).filter(Boolean).filter(v=>!header(v));
  let dateIndex=usable.length;
  for(let i=usable.length-1;i>=0;i--){if(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(usable[i])){dateIndex=i;break;}}
  const beforeDate=usable.slice(0,dateIndex).map(stripPhones).filter(Boolean);

  for(let locationEnd=beforeDate.length-1;locationEnd>=0;locationEnd--){
    let streetStart=-1;
    for(let i=locationEnd;i>=0;i--){if(streetLike(beforeDate[i])){streetStart=i;break;}}
    if(streetStart<0)continue;

    const locationFragment=beforeDate.slice(streetStart,locationEnd+1).join(' ').replace(/\s+/g,' ').trim();
    if(!STATE_ZIP_RE.test(locationFragment)){STATE_ZIP_RE.lastIndex=0;continue;}
    STATE_ZIP_RE.lastIndex=0;
    const parsed=splitStreetAndCity(locationFragment);
    if(!parsed)continue;

    const name=normalizeName(beforeDate.slice(0,streetStart).join(' '));
    if(!name)continue;
    return candidate(name,parsed.streetAddress,parsed.city,licenseNumber);
  }

  return null;
}

function parseActiveText(text:string):IllinoisCandidate[]{
  const activeHeading='Active Adult Use Dispensing Organization Licenses';
  const firstHeading=text.indexOf(activeHeading);
  const start=firstHeading>=0?text.indexOf(activeHeading,firstHeading+activeHeading.length):0;
  const activeStart=start>=0?start:firstHeading>=0?firstHeading:0;
  const end=text.indexOf('Original Lottery Conditional License List',activeStart+activeHeading.length);
  const section=text.slice(activeStart,end>activeStart?end:text.length);
  const lines=section.split(/\r?\n/).map(v=>clean(v)).filter(Boolean);
  const rows:IllinoisCandidate[]=[];
  let recordStart=0;

  for(let i=0;i<lines.length;i++){
    const credentialMatch=lines[i].match(CREDENTIAL_RE);
    if(!credentialMatch)continue;
    const parsed=parseRecord(lines.slice(recordStart,i+1),credentialMatch[0]);
    if(parsed)rows.push(parsed);
    recordStart=i+1;
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
    const textResult=await parser.getText();
    const text=textResult.text||'';
    const rows=parseActiveText(text);
    const declaredMatch=text.match(/Total Number of Active Adult Use Dispensing Organization Licenses:\s*(\d+)/i);
    const declared=declaredMatch?Number(declaredMatch[1]):0;
    const minimum=declared>0?Math.max(200,Math.floor(declared*0.9)):200;
    if(rows.length>=minimum)return rows;
    throw new Error(`Illinois IDFPR PDF parser found only ${rows.length}${declared?` of ${declared}`:''} valid active dispensary rows; refusing a partial import.`);
  }finally{await parser.destroy();}
}
