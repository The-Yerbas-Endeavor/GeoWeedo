import 'server-only';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

type MississippiCandidate={name:string;streetAddress?:string;city?:string;region:string;country:string;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://www.mmcp.ms.gov/search_business';
const DATASET_URL='https://data.mmcp.ms.gov/resource/t9ah-e7ja.json?$limit=50000';
const execFileAsync=promisify(execFile);

function clean(value:unknown){return String(value??'').replace(/\s+/g,' ').trim();}
function key(value:string){return value.toLowerCase().replace(/[^a-z0-9]/g,'');}
function normalizeObject(input:Record<string,unknown>){const out:Record<string,unknown>={};for(const [k,v] of Object.entries(input))out[key(k)]=v;return out;}
function pick(r:Record<string,unknown>,names:string[]){for(const name of names){const v=r[key(name)];if(v!==undefined&&v!==null&&clean(v))return clean(v);}return '';}
function pickByKey(r:Record<string,unknown>,tests:RegExp[]){for(const [k,v] of Object.entries(r)){if(tests.some(test=>test.test(k))&&clean(v))return clean(v);}return '';}

async function fetchJsonWithFallback(url:string):Promise<unknown>{
 try{
  const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return await response.json();
 }catch(fetchError){
  try{
   const {stdout}=await execFileAsync('curl',['-fL','--retry','2','--connect-timeout','10','--max-time','45','-A','GeoWeedo/0.7 (https://geoweedo.com)',url],{maxBuffer:32*1024*1024});
   return JSON.parse(stdout);
  }catch(curlError){
   const a=fetchError instanceof Error?fetchError.message:String(fetchError);
   const b=curlError instanceof Error?curlError.message:String(curlError);
   throw new Error(`Mississippi MMCP data fetch failed (fetch: ${a}; curl fallback: ${b}).`);
  }
 }
}

export async function fetchMississippiCandidates():Promise<MississippiCandidate[]>{
 const body=await fetchJsonWithFallback(DATASET_URL);
 if(!Array.isArray(body))throw new Error('Mississippi MMCP public dataset did not return a row array.');

 const rows:MississippiCandidate[]=[];
 for(const raw of body){
  if(!raw||typeof raw!=='object')continue;
  const r=normalizeObject(raw as Record<string,unknown>);
  const allText=Object.values(r).map(clean).join(' ');
  const licenseNumber=pick(r,['licenseNumber','license','licenseId','credentialNumber','applicationNumber','recordId'])||pickByKey(r,[/license.*number/,/credential.*number/,/^licenseid$/,/^applicationnumber$/]);
  const businessType=pick(r,['businessType','licenseType','facilityType','applicationType','authorizationType'])||pickByKey(r,[/businesstype/,/licensetype/,/facilitytype/,/applicationtype/]);
  if(!/^DSPY/i.test(licenseNumber)&&!/\bdispensar/i.test(businessType)&&!/\bdispensar/i.test(allText))continue;

  const status=pick(r,['status','licenseStatus','applicationStatus','currentStatus'])||pickByKey(r,[/status$/]);
  if(/denied|withdrawn|expired|revoked|surrendered|closed|inactive/i.test(status))continue;

  const name=pick(r,['dbaName','businessName','legalBusinessName','facilityName','establishmentName','applicantName','name'])||pickByKey(r,[/^dba/,/business.*name/,/facility.*name/,/establishment.*name/,/applicant.*name/]);
  const streetAddress=pick(r,['physicalAddress','businessAddress','facilityAddress','streetAddress','address1','address'])||pickByKey(r,[/physical.*address/,/business.*address/,/facility.*address/,/street.*address/,/^address1$/]);
  const city=pick(r,['physicalCity','businessCity','facilityCity','city'])||pickByKey(r,[/physical.*city/,/business.*city/,/facility.*city/,/^city$/]);
  if(!name)continue;

  rows.push({name,streetAddress:streetAddress||undefined,city:city||undefined,region:'Mississippi',country:'USA',licenseNumber:licenseNumber||undefined,dataSource:'Mississippi MMCP Public Application Records',sourceUrl:SOURCE_URL,sourceLicense:'Official Mississippi Medical Cannabis Program public transparency dataset; records identified as dispensaries by license prefix, business/license type, or dataset content.',imageryStatus:'missing_coordinates'});
 }

 const unique=new Map<string,MississippiCandidate>();
 for(const row of rows){const dedupe=(row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`).toLowerCase().replace(/[^a-z0-9|]/g,'');if(!unique.has(dedupe))unique.set(dedupe,row);}
 const result=Array.from(unique.values());
 if(result.length<50)throw new Error(`Mississippi MMCP public data yielded only ${result.length} recognizable dispensary records from ${body.length} source rows; refusing a likely partial or schema-mismatched import.`);
 return result;
}
