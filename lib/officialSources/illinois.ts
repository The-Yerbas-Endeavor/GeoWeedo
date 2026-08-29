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
function normalizeCredential(value:string){const m=value.toUpperCase().match(/284\.(\d{6,7})[.\s-]*AUDO/i);return m?`284.${m[1]}-AUDO`:value.toUpperCase();}
function candidate(name:string,streetAddress:string,city:string,licenseNumber:string):IllinoisCandidate{return{name:normalizeName(name),streetAddress:clean(streetAddress),city:clean(city),region:'Illinois',country:'USA',licenseNumber:normalizeCredential(licenseNumber),dataSource:SOURCE_NAME,sourceUrl:SOURCE_PAGE,sourceLicense:SOURCE_LICENSE,imageryStatus:'missing_coordinates'};}

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
    .replace(/License Holder\s+Dispensary Name\s+Address\s*&\s*Phone/gi,' ')
    .replace(/License Issue\s+Date\s+Adult Use Credential\s+Number/gi,' ')
    .replace(/idfpr\.illinois\.gov/gi,' ')
    .replace(/JB PRITZKER\s+Governor/gi,' ')
    .replace(/MARIO TRETO,?\s*JR\.?\s+Secretary/gi,' ')
    .replace(/CAMILE LINDSAY\s+Director/gi,' ')
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function parseDeclaredTotal(text:string){const m=text.match(/Total Number of Active Adult Use Dispensing Organization Licenses:\s*(\d+)/i);return m?Number(m[1]):undefined;}

function cleanCity(raw:string){
  let city=clean(raw);
  const addressWord=/\b(?:St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Hwy|Highway|Pkwy|Parkway|Ct|Court|Pl|Place|Way|Trl|Trail|Route|Rte)\.?\s+/gi;
  const matches=Array.from(city.matchAll(addressWord));
  const last=matches.at(-1);
  if(last?.index!==undefined){
    const tail=city.slice(last.index+last[0].length).trim();
    if(tail)city=tail;
  }
  return city.replace(/^\d+[A-Za-z-]?\s+/,'').trim();
}

function parseRecord(raw:string,licenseNumber:string):IllinoisCandidate|null{
  let body=stripPdfNoise(raw).replace(PHONE_RE,' ').replace(/\s+/g,' ').trim();
  const dates=Array.from(body.matchAll(DATE_RE));
  const lastDate=dates.at(-1);
  if(lastDate?.index!==undefined)body=body.slice(0,lastDate.index).trim();
  if(!body)return null;

  const cities=Array.from(body.matchAll(CITY_STATE_ZIP_RE));
  const cityMatch=cities.at(-1);
  if(!cityMatch||cityMatch.index===undefined)return null;

  const rawCity=cityMatch[1].trim();
  const city=cleanCity(rawCity);
  if(!city)return null;

  const cityStart=cityMatch.index + Math.max(0, rawCity.length-city.length);
  const beforeCity=body.slice(0,cityStart).trim();
  const addressStarts=Array.from(beforeCity.matchAll(ADDRESS_START_RE));
  if(!addressStarts.length)return null;

  // In IDFPR's flattened PDF text, the physical address is the last numbered
  // street-style segment before the city/state/ZIP. Ignore likely ZIP/date/page numbers.
  const plausible=addressStarts.filter(m=>{
    const idx=m.index??-1;
    if(idx<0)return false;
    const token=m[0].trim().split(/\s+/)[0];
    const n=Number(token.replace(/[^0-9]/g,''));
    if(!Number.isFinite(n))return false;
    if(n>=1900&&n<=2100&&/\/$/.test(beforeCity.slice(Math.max(0,idx-3),idx)))return false;
    return (beforeCity.length-idx)<=220;
  });
  const pool=plausible.length?plausible:addressStarts;
  let chosen=pool.at(-1);

  // Suite/unit numbers can appear after a real street number. Walk left while the
  // candidate looks like a short unit token rather than the beginning of an address.
  for(let k=pool.length-1;k>0;k--){
    const current=pool[k];
    const previous=pool[k-1];
    if(current.index===undefined||previous.index===undefined)continue;
    const suffix=beforeCity.slice(current.index).trim();
    if(/^\d{1,4}\s*$/.test(suffix)||/^(?:#|Ste\.?|Suite|Unit)\s*\d+/i.test(suffix))chosen=previous;
    else break;
  }

  if(!chosen||chosen.index===undefined)return null;
  const streetAddress=beforeCity.slice(chosen.index).trim().replace(/[;,]+$/,'');
  let name=beforeCity.slice(0,chosen.index).trim();
  name=name.replace(/^(?:\d+\s+)?(?:Links to each document.*?)$/i,'').trim();
  if(!name||!streetAddress)return null;
  if(streetAddress.length>220||name.length>260)return null;

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
    // Default text extraction preserves this table more consistently than lineEnforce.
    const textResult=await parser.getText();
    const text=textResult.text||'';
    const rows=parseActiveText(text);
    const declared=parseDeclaredTotal(text);
    const minimum=declared?Math.max(200,Math.floor(declared*0.9)):200;
    if(rows.length>=minimum)return rows;
    throw new Error(`Illinois IDFPR PDF parser found only ${rows.length}${declared?` of ${declared}`:''} valid active dispensary rows; refusing a partial import.`);
  }finally{await parser.destroy();}
}
