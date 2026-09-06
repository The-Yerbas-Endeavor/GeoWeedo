import 'server-only';

type MississippiCandidate={name:string;streetAddress?:string;city?:string;region:string;country:string;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'missing_coordinates'};

const SOURCE_URL='https://www.mmcp.ms.gov/search_business';
const DATASET_API='https://data.mmcp.ms.gov/resource/t9ah-e7ja.json?$limit=50000';

function normalizeObject(input:Record<string,unknown>){const out:Record<string,unknown>={};for(const [k,v] of Object.entries(input))out[k.toLowerCase().replace(/[^a-z0-9]/g,'')]=v;return out;}
function pick(r:Record<string,unknown>,names:string[]){for(const n of names){const v=r[n];if(v!==undefined&&v!==null&&String(v).trim()!=='')return String(v).trim();}return '';}

export async function fetchMississippiCandidates():Promise<MississippiCandidate[]>{
 const response=await fetch(DATASET_API,{headers:{Accept:'application/json','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Mississippi MMCP public application dataset returned ${response.status}.`);
 const body=await response.json();
 if(!Array.isArray(body))throw new Error('Mississippi MMCP public application dataset did not return a row array.');
 const rows=body.map((raw:Record<string,unknown>)=>normalizeObject(raw)).filter(r=>{
  const type=pick(r,['licensetype','businesslicensetype','applicationtype','businessapplicationtype','authorizationtype','facilitytype']);
  const status=pick(r,['status','applicationstatus','licensestatus','currentstatus']);
  const combined=`${type} ${pick(r,['businessname','legalbusinessname','dbaname','facilityname','applicantname','name'])}`;
  const dispensary=/dispensar/i.test(combined);
  const approved=!status||/approved|active|issued|current/i.test(status);
  const rejected=/denied|withdrawn|expired|revoked|surrendered|closed|inactive/i.test(status);
  return dispensary&&approved&&!rejected;
 }).map(r=>{
  const name=pick(r,['dbaname','businessname','legalbusinessname','facilityname','applicantname','name']);
  const streetAddress=pick(r,['physicaladdress','businessaddress','facilityaddress','streetaddress','address1','address']);
  const city=pick(r,['physicalcity','businesscity','facilitycity','city']);
  const licenseNumber=pick(r,['licensenumber','licenseid','authorizationnumber','applicationnumber','recordid']);
  return {name,streetAddress:streetAddress||undefined,city:city||undefined,region:'Mississippi',country:'USA',licenseNumber:licenseNumber||undefined,dataSource:'Mississippi MMCP Public Application Records',sourceUrl:SOURCE_URL,sourceLicense:'Official Mississippi Medical Cannabis Program public business-search / transparency data; dispensary records only.',imageryStatus:'missing_coordinates' as const};
 }).filter(r=>r.name);
 const unique=new Map<string,MississippiCandidate>();
 for(const row of rows){const key=(row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`).toLowerCase().replace(/[^a-z0-9|]/g,'');if(!unique.has(key))unique.set(key,row);}
 const result=Array.from(unique.values());
 if(result.length<50)throw new Error(`Mississippi MMCP public data yielded only ${result.length} recognizable dispensary records; refusing a likely partial or schema-mismatched import.`);
 return result;
}
