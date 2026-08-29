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

function clean(value:unknown){return String(value??'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,'\n').trim();}
function normalizeName(value:string){return clean(value).replace(/\s+/g,' ').replace(/^[-–—|]+|[-–—|]+$/g,'').trim();}
function unique(rows:IllinoisCandidate[]){const map=new Map<string,IllinoisCandidate>();for(const row of rows){const id=row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`.toLowerCase();if(!map.has(id))map.set(id,row);}return Array.from(map.values());}
function candidate(name:string,streetAddress:string,city:string,licenseNumber:string):IllinoisCandidate{return{name:normalizeName(name),streetAddress:clean(streetAddress),city:clean(city),region:'Illinois',country:'USA',licenseNumber:licenseNumber.toUpperCase(),dataSource:SOURCE_NAME,sourceUrl:SOURCE_PAGE,sourceLicense:SOURCE_LICENSE,imageryStatus:'missing_coordinates'};}
function phone(value:string){return /^\(?\d{3}\)?\s*[-.]?\s*\d{3}\s*[-.]?\s*\d{4}$/i.test(value.replace(/\s+/g,' '));}
function header(value:string){return /^(?:Links to each document|Active Adult Use Dispensing Organization Licenses|Total Number of Active.*|Dispensaries highlighted.*|Dispensaries that are.*|License Holder|Dispensary Name|Address & Phone|Number$|License Issue|Date$|Adult Use Credential|idfpr\.illinois\.gov|JB PRITZKER|Governor|MARIO TRETO.*|Secretary|CAMILE LINDSAY|Director|\d+)$/i.test(value);}
function streetLike(value:string){return /^\d{1,6}[A-Za-z-]?\s+/.test(value)||/^\d+[A-Za-z]?\s*(?:N|S|E|W)\.?\s+/i.test(value);}
function cityMatch(value:string){return value.match(/^(.+?),\s*(?:IL|Illinois)\s+(\d{5}(?:-\s*\d{4})?)\b/i);}

function parseActiveText(text:string):IllinoisCandidate[]{
  const start=text.search(/Active Adult Use Dispensing Organization Licenses/i);
  const end=text.search(/Original Lottery Conditional License List/i);
  const section=text.slice(start>=0?start:0,end>start?end:text.length);
  const lines=section.split(/\r?\n/).map(v=>clean(v)).filter(Boolean).filter(v=>!header(v));
  const rows:IllinoisCandidate[]=[];
  let recordStart=0;

  for(let i=0;i<lines.length;i++){
    const credentialMatch=lines[i].match(/284\.\d{6,7}-AUDO\b/i);
    if(!credentialMatch)continue;
    const licenseNumber=credentialMatch[0];

    let dateIndex=i;
    for(let j=i;j>=recordStart;j--){if(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(lines[j])){dateIndex=j;break;}}

    let cityIndex=-1;
    let city='';
    for(let j=dateIndex-1;j>=recordStart;j--){const match=cityMatch(lines[j]);if(match){cityIndex=j;city=match[1].trim();break;}}
    if(cityIndex<0){recordStart=i+1;continue;}

    let streetEnd=cityIndex-1;
    while(streetEnd>=recordStart&&phone(lines[streetEnd]))streetEnd--;
    let streetStart=-1;
    for(let j=streetEnd;j>=recordStart;j--){if(streetLike(lines[j])){streetStart=j;break;}}
    if(streetStart<0){recordStart=i+1;continue;}

    const streetAddress=lines.slice(streetStart,cityIndex).filter(v=>!phone(v)).join(' ').replace(/\s+/g,' ').trim();
    const nameParts=lines.slice(recordStart,streetStart).filter(v=>!phone(v)&&!header(v)&&!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v));
    const name=normalizeName(nameParts.join(' '));
    if(name&&streetAddress&&city)rows.push(candidate(name,streetAddress,city,licenseNumber));
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
    const rows=parseActiveText(textResult.text||'');
    if(rows.length>=200)return rows;
    throw new Error(`Illinois IDFPR PDF parser found only ${rows.length} valid active dispensary rows; refusing a partial import.`);
  }finally{await parser.destroy();}
}
