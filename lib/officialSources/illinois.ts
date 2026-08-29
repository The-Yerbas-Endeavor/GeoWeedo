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

function clean(value:unknown){return String(value??'').replace(/\u00a0/g,' ').replace(/[\t\r\n]+/g,' ').replace(/\s+/g,' ').trim();}
function normalizeName(value:string){return clean(value).replace(/^[-–—|]+|[-–—|]+$/g,'').trim();}
function unique(rows:IllinoisCandidate[]){const map=new Map<string,IllinoisCandidate>();for(const row of rows){const id=row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`.toLowerCase();if(!map.has(id))map.set(id,row);}return Array.from(map.values());}
function candidate(name:string,streetAddress:string,city:string,licenseNumber:string):IllinoisCandidate{return{name:normalizeName(name),streetAddress:clean(streetAddress),city:clean(city),region:'Illinois',country:'USA',licenseNumber:normalizeCredential(licenseNumber),dataSource:SOURCE_NAME,sourceUrl:SOURCE_PAGE,sourceLicense:SOURCE_LICENSE,imageryStatus:'missing_coordinates'};}
function normalizeCredential(value:string){return value.toUpperCase().replace(/284\.(\d{6,7})[.\s-]*AUDO/i,'284.$1-AUDO');}

const CREDENTIAL_RE=/284\.\d{6,7}[.\s-]*AUDO\b/gi;
const DATE_RE=/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
const PHONE_RE=/\(?\d{3}\)?\s*[-.]?\s*\d{3}\s*[-.]?\s*\d{4}/g;
const CITY_STATE_ZIP_RE=/([A-Za-z][A-Za-z .'-]{1,60}?),\s*(?:IL|Illinois)\.?\s+(\d{5})(?:\s*-\s*(\d{4}))?\b/gi;
const ADDRESS_START_RE=/(?<![#\d])\b\d{1,6}[A-Za-z-]?\s+(?=[A-Za-z0-9])/g;

function stripPdfNoise(value:string){
  return clean(value)
    .replace(/Links to each document:.*?SECL Conditional License List/gi,' ')
    .replace(/Active Adult Use Dispensing Organization Licenses/gi,' ')
    .replace(/Total Number of Active Adult Use Dispensing Organization Licenses:\s*\d+/gi,' ')
    .replace(/Dispensaries highlighted in Blue are dispensaries that serve Medical Patients/gi,' ')
    .replace(/Dispensaries that are BOLDED were awarded in the social equity lotteries established by the CRTA/gi,' ')
    .replace(/License Holder\s+Dispensary Name\s+Address\s*&\s*Phone\s+Number\s+License Issue\s+Date\s+Adult Use Credential\s+Number/gi,' ')
    .replace(/idfpr\.illinois\.gov/gi,' ')
    .replace(/JB PRITZKER\s+Governor/gi,' ')
    .replace(/MARIO TRETO,?\s*JR\.?\s+Secretary/gi,' ')
    .replace(/CAMILE LINDSAY\s+Director/gi,' ')
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function parseDeclaredTotal(text:string){const m=text.match(/Total Number of Active Adult Use Dispensing Organization Licenses:\s*(\d+)/i);return m?Number(m[1]):undefined;}

function parseRecord(raw:string,licenseNumber:string):IllinoisCandidate|null{
  let body=stripPdfNoise(raw).replace(PHONE_RE,' ').replace(/\s+/g,' ').trim();
  const dates=Array.from(body.matchAll(DATE_RE));
  const lastDate=dates.at(-1);
  if(lastDate?.index!==undefined)body=body.slice(0,lastDate.index).trim();

  const cities=Array.from(body.matchAll(CITY_STATE_ZIP_RE));
  const cityMatch=cities.at(-1);
  if(!cityMatch||cityMatch.index===undefined)return null;

  const city=cityMatch[1].trim();
  const beforeCity=body.slice(0,cityMatch.index).trim();
  const addressStarts=Array.from(beforeCity.matchAll(ADDRESS_START_RE));
  if(!addressStarts.length)return null;

  // Prefer the first plausible numbered token in the last 180 characters before the city.
  // This avoids mistaking suite/unit numbers near the end of an address for the address start.
  const nearby=addressStarts.filter(m=>(beforeCity.length-(m.index??0))<=180);
  const chosen=(nearby.length?nearby:addressStarts).at(0);
  if(!chosen||chosen.index===undefined)return null;

  const streetAddress=beforeCity.slice(chosen.index).trim().replace(/[;,]+$/,'');
  let name=beforeCity.slice(0,chosen.index).trim();
  name=name.replace(/^(?:\d+\s+)?(?:Links to each document.*?)$/i,'').trim();
  if(!name||!streetAddress||!city)return null;
  if(streetAddress.length>180||name.length>220)return null;

  return candidate(name,streetAddress,city,licenseNumber);
}

function parseActiveText(text:string):IllinoisCandidate[]{
  const start=text.search(/Active Adult Use Dispensing Organization Licenses/i);
  const end=text.search(/Original Lottery Conditional License List/i);
  const section=text.slice(start>=0?start:0,end>start?end:text.length);
  const matches=Array.from(section.matchAll(CREDENTIAL_RE));
  const rows:IllinoisCandidate[]=[];
  let previousEnd=0;

  for(const match of matches){
    if(match.index===undefined)continue;
    const record=section.slice(previousEnd,match.index);
    const parsed=parseRecord(record,match[0]);
    if(parsed)rows.push(parsed);
    previousEnd=match.index+match[0].length;
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
    const textResult=await parser.getText({first:2,last:21,lineEnforce:true,cellSeparator:'\n'});
    const text=textResult.text||'';
    const rows=parseActiveText(text);
    const declared=parseDeclaredTotal(text);
    const minimum=declared?Math.max(200,Math.floor(declared*0.9)):200;
    if(rows.length>=minimum)return rows;
    throw new Error(`Illinois IDFPR PDF parser found only ${rows.length}${declared?` of ${declared}`:''} valid active dispensary rows; refusing a partial import.`);
  }finally{await parser.destroy();}
}
