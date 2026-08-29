import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { importCandidates } from '@/lib/candidateStore';

export const runtime = 'nodejs';

type CandidateRow = {
  name: string;
  streetAddress?: string;
  city?: string;
  region?: string;
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

type DccResponse = { data?: unknown[]; metadata?: { hasNext?: boolean; totalPages?: number } };
type SyncDetail = { ok:boolean; source:string; fetched:number; added:number; geocoded:number; total?:number; error?:string };

function key(value:string){return value.toLowerCase().replace(/[^a-z0-9]/g,'');}
function pick(row:Record<string,any>, names:string[]){for(const name of names){const value=row[name];if(value!==undefined&&value!==null&&String(value).trim()!=='')return String(value).trim();}return '';}
function coord(value:unknown){if(value==null||value==='')return undefined;const n=Number(value);return Number.isFinite(n)?n:undefined;}
function readiness(latitude?:number,longitude?:number){return latitude!==undefined&&longitude!==undefined?'unchecked' as const:'missing_coordinates' as const;}
function point(value:any){if(!value)return {};if(typeof value==='object'){const latitude=coord(value.latitude??value.lat??value.coordinates?.[1]);const longitude=coord(value.longitude??value.lng??value.lon??value.coordinates?.[0]);return {latitude,longitude};}const m=String(value).match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);return m?{longitude:Number(m[1]),latitude:Number(m[2])}:{};}
function normalizeObject(input:Record<string,any>){const out:Record<string,any>={};for(const [k,v] of Object.entries(input))out[key(k)]=v;return out;}
function browserHeaders(){return {Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept-Language':'en-US,en;q=0.9'};}

async function getJson(url:string){
  let response:Response;
  try{response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'GeoWeedo/0.5 (https://geoweedo.yerbas.org)'},cache:'no-store',signal:AbortSignal.timeout(30000)});}catch(error){const host=(()=>{try{return new URL(url).host;}catch{return url;}})();throw new Error(`Could not connect to official data source ${host}: ${error instanceof Error?error.message:String(error)}`);}
  if(!response.ok){const detail=(await response.text().catch(()=>''))?.slice(0,180).replace(/\s+/g,' ').trim();throw new Error(`Official data source ${new URL(url).host} returned ${response.status}${detail?`: ${detail}`:''}`);}
  try{return await response.json();}catch{throw new Error(`Official data source ${new URL(url).host} returned invalid JSON.`);}
}

async function getHtml(url:string,label:string){
  let response:Response;
  try{response=await fetch(url,{headers:browserHeaders(),cache:'no-store',signal:AbortSignal.timeout(30000)});}catch(error){throw new Error(`${label} connection failed: ${error instanceof Error?error.message:String(error)}`);}
  if(!response.ok)throw new Error(`${label} returned ${response.status}`);
  return response.text();
}

async function fetchCalifornia():Promise<CandidateRow[]>{
  const sourceUrl='https://search.cannabis.ca.gov/';
  const api='https://as-dcc-pub-cann-w-p-002.azurewebsites.net/licenses/filteredsearch';
  const all:any[]=[];const pageSize=500;let page=1;let hasNext=true;
  while(hasNext&&page<=100){const body=await getJson(`${api}?pageSize=${pageSize}&pageNumber=${page}&searchQuery=`) as DccResponse;const data=Array.isArray(body?.data)?body.data:[];all.push(...data);hasNext=Boolean(body?.metadata?.hasNext);page++;}
  if(hasNext)throw new Error('California DCC sync stopped after 100 pages; refusing a partial import.');
  const rows=all.map(raw=>normalizeObject(raw as Record<string,any>)).filter(r=>{const licenseNumber=pick(r,['licensenumber','license']);const type=pick(r,['licensetype','type']);const status=pick(r,['licensestatus','status']);return (/^c10-/i.test(licenseNumber)||(/retailer/i.test(type)&&!/nonstorefront|non-storefront|delivery/i.test(type)))&&(/^active\b/i.test(status)||/about to expire/i.test(status));}).map(r=>{const geo=point(r.georeference??r.location??r.geolocation??r.point);const latitude=coord(r.premiselatitude??r.latitude)??geo.latitude;const longitude=coord(r.premiselongitude??r.longitude)??geo.longitude;return{name:pick(r,['businessdbaname','dbaname','businesslegalname','legalbusinessname','businessname','name']),streetAddress:pick(r,['premisestreetaddress','streetaddress','premiseaddress','address'])||undefined,city:pick(r,['premisecity','city'])||undefined,region:'California',country:'USA',latitude,longitude,website:pick(r,['businesswebsite','website','url'])||undefined,licenseNumber:pick(r,['licensenumber','license'])||undefined,dataSource:'California DCC Unified License Search',sourceUrl,sourceLicense:'Official California Department of Cannabis Control public license-search data; active storefront retailers only.',imageryStatus:readiness(latitude,longitude)};}).filter(r=>r.name);
  const unique=new Map<string,CandidateRow>();for(const row of rows){const id=row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`;if(!unique.has(id))unique.set(id,row);}return Array.from(unique.values());
}

async function fetchOregon():Promise<CandidateRow[]>{
  const sourceUrl='https://data.oregon.gov/Business/OLCC-Cannabis-Business-Licenses-Endorsements/q32u-cmam';
  const data=await getJson('https://data.oregon.gov/resource/q32u-cmam.json?$limit=5000');
  return (Array.isArray(data)?data:[]).filter((r:any)=>String(r.license_type||'').toLowerCase().includes('retail')&&!String(r.license_expired||'').toLowerCase().includes('yes')).map((r:any)=>{const latitude=coord(r.latitude),longitude=coord(r.longitude);return{name:String(r.business_name||r.business_licenses||'').trim(),streetAddress:String(r.physical_address||'').trim()||undefined,region:'Oregon',country:'USA',latitude,longitude,licenseNumber:String(r.license_number||'').trim()||undefined,dataSource:'Oregon OLCC Open Data',sourceUrl,sourceLicense:'Official Oregon Open Data.',imageryStatus:readiness(latitude,longitude)};}).filter((r:any)=>r.name);
}

async function fetchColorado():Promise<CandidateRow[]>{
  const sourceUrl='https://data.colorado.gov/Government/Licensed-Marijuana-Businesses-in-Colorado/93ae-ftjz';
  const data=await getJson('https://data.colorado.gov/resource/93ae-ftjz.json?$limit=50000');
  const rows=(Array.isArray(data)?data:[]).map((raw:any)=>normalizeObject(raw)).map(r=>{
    const type=pick(r,['licensetype','licensetypecode','facilitytype','businesstype','type','licenseclass']);
    if(type&&!/retail/i.test(type))return null;
    const status=pick(r,['licensestatus','status']);
    if(status&&/expired|revoked|surrendered|cancelled|closed|inactive/i.test(status))return null;
    const licenseNumber=pick(r,['licensenumber','license','licenseid','credentialnumber']);
    const name=pick(r,['dbaname','tradename','businessname','businesslegalname','facilityname','licenseename','name']);
    const geo=point(r.location??r.geolocation??r.point??r.georeference);
    const latitude=coord(r.latitude??r.lat)??geo.latitude;
    const longitude=coord(r.longitude??r.lng??r.lon)??geo.longitude;
    return{name,streetAddress:pick(r,['streetaddress','address','premiseaddress','locationaddress','physicaladdress'])||undefined,city:pick(r,['city','premisecity','locationcity','municipality'])||undefined,region:'Colorado',country:'USA',latitude,longitude,licenseNumber:licenseNumber||undefined,dataSource:'Colorado MED Licensed Marijuana Businesses',sourceUrl,sourceLicense:'Official Colorado Department of Revenue Marijuana Enforcement Division open data; retail licenses only.',imageryStatus:readiness(latitude,longitude)} as CandidateRow;
  }).filter(Boolean).filter((r:any)=>r.name) as CandidateRow[];
  const unique=new Map<string,CandidateRow>();for(const row of rows){const id=row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`;if(!unique.has(id))unique.set(id,row);}return Array.from(unique.values());
}

async function fetchMassachusetts():Promise<CandidateRow[]>{
  const sourceUrl='https://masscannabiscontrol.com/open-data/data-catalog/';
  const data=await getJson('https://masscannabiscontrol.com/resource/l_licenses_commence_ops.json');
  const rows=(Array.isArray(data)?data:[]).map((raw:any)=>normalizeObject(raw)).filter(r=>{const type=pick(r,['licensetype']);const status=pick(r,['licensestatus','licensestatuscategory']);const commence=pick(r,['commenceops']);return /marijuana retailer/i.test(type)&&(!status||/^active$/i.test(status))&&(!commence||/^yes$/i.test(commence));}).map(r=>{const latitude=coord(r.latitude??r.establishmentlatitude);const longitude=coord(r.longitude??r.establishmentlongitude);return{name:pick(r,['dbaname','businessname','establishmentname'])||pick(r,['businessname']),streetAddress:pick(r,['establishmentaddress1','businessaddress1'])||undefined,city:pick(r,['establishmentcity','businesscity'])||undefined,region:'Massachusetts',country:'USA',latitude,longitude,licenseNumber:pick(r,['licensenumber','licensenumberbase'])||undefined,dataSource:'Massachusetts CCC Commence Operations',sourceUrl,sourceLicense:'Official Massachusetts Cannabis Control Commission open data; active adult-use Marijuana Retailer licenses that commenced operations.',imageryStatus:readiness(latitude,longitude)} as CandidateRow;}).filter(r=>r.name);
  const unique=new Map<string,CandidateRow>();for(const row of rows){const id=row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`;if(!unique.has(id))unique.set(id,row);}return Array.from(unique.values());
}

async function fetchNevada():Promise<CandidateRow[]>{
  const sourceUrl='https://ccb.nv.gov/list-of-licensees/';const html=await getHtml(sourceUrl,'Nevada CCB');const plain=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#8211;|&ndash;/g,'–').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');const rows:CandidateRow[]=[];const regex=/([A-Z0-9][A-Z0-9 '&.!/()-]{2,80})\s*[–-]\s*([^|]{5,120}?)\s*[–-]\s*(Adult Use|Medical Only)\s*\|?\s*(\d{15,25})/gi;let m:RegExpExecArray|null;while((m=regex.exec(plain))!==null){const name=m[1].trim().replace(/^Y\s+|^N\s+/i,''),licenseNumber=m[4].trim();if(!name||rows.some(r=>r.licenseNumber===licenseNumber))continue;rows.push({name,streetAddress:m[2].trim(),region:'Nevada',country:'USA',licenseNumber,dataSource:'Nevada CCB Licensed Retail Locations',sourceUrl,sourceLicense:'Official Nevada Cannabis Compliance Board public retail-location list.',imageryStatus:'missing_coordinates'});}return rows;
}

async function fetchWashington():Promise<CandidateRow[]>{
  const sourceUrl='https://data.wa.gov/d/brpd-b6zd';
  const data=await getJson('https://data.wa.gov/resource/brpd-b6zd.json?$limit=50000');
  const rows=(Array.isArray(data)?data:[]).map((raw:any)=>normalizeObject(raw)).map(r=>{
    const licenseNumber=pick(r,['licensenumber','license','licenseid','licenseidentifier','ubi']);
    const name=pick(r,['tradename','businessname','businesslegalname','companyname','licenseename','applicantname','applicant','entityname','name'])||`Washington Cannabis Renewal ${licenseNumber||pick(r,['city','locationcity','premisecity'])||'record'}`;
    const geo=point(r.location??r.geolocation??r.point??r.geocodedcolumn);
    const latitude=coord(r.latitude??r.lat)??geo.latitude;
    const longitude=coord(r.longitude??r.lng??r.lon??r.long)??geo.longitude;
    const streetAddress=pick(r,['streetaddress','address','premiseaddress','locationaddress','physicaladdress','businessaddress','addressline1'])||undefined;
    const city=pick(r,['city','premisecity','locationcity','businesscity','locality'])||undefined;
    return{name,streetAddress,city,region:'Washington',country:'USA',latitude,longitude,licenseNumber:licenseNumber||undefined,dataSource:'Washington LCB Cannabis Renewal Open Data',sourceUrl,sourceLicense:'Official Washington State Liquor and Cannabis Board Cannabis Renewal dataset.',imageryStatus:readiness(latitude,longitude)} as CandidateRow;
  }).filter(r=>Boolean(r.name)&&Boolean(r.city||r.streetAddress||r.licenseNumber));
  const unique=new Map<string,CandidateRow>();for(const row of rows){const id=row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`;if(!unique.has(id))unique.set(id,row);}return Array.from(unique.values());
}

async function fetchConnecticut():Promise<CandidateRow[]>{
  const sourceUrl='https://data.ct.gov/d/4vi8-t7ex';
  let data:any=await getJson('https://data.ct.gov/resource/4vi8-t7ex.json?$limit=5000');
  if(!Array.isArray(data)||!data.length)data=await getJson('https://data.ct.gov/resource/42yd-3x3d.json?$limit=5000');
  return (Array.isArray(data)?data:[]).map((raw:any)=>normalizeObject(raw)).map(r=>{const geo=point(r.geocodedcolumn??r.georeference??r.location??r.geolocation??r.point);const latitude=coord(r.latitude??r.lat)??geo.latitude;const longitude=coord(r.longitude??r.lng??r.lon)??geo.longitude;const licenseNumber=pick(r,['credentialnumber','licensenumber','licenseid','license']);const name=pick(r,['dbaname','doingbusinessas','facilityname','businessname','businesslegalname','licenseename','name'])||`Connecticut Cannabis Retailer ${licenseNumber}`;return{name,streetAddress:pick(r,['streetaddress','address','premiseaddress','locationaddress'])||undefined,city:pick(r,['city','town','municipality'])||undefined,region:'Connecticut',country:'USA',latitude,longitude,website:pick(r,['website','url'])||undefined,licenseNumber:licenseNumber||undefined,dataSource:'Connecticut DCP Cannabis Retail Locations',sourceUrl,sourceLicense:'Official Connecticut Department of Consumer Protection open data.',imageryStatus:readiness(latitude,longitude)};}).filter(r=>r.name);
}

async function fetchNewYork():Promise<CandidateRow[]>{
  const sourceUrl='https://data.ny.gov/d/jskf-tt3q';const data=await getJson('https://data.ny.gov/resource/jskf-tt3q.json?$limit=10000');return (Array.isArray(data)?data:[]).map((raw:any)=>{const r=normalizeObject(raw);const type=pick(r,['licensetype','licensecategory','type']);const status=pick(r,['licensestatus','status']);if(type&&!/retail|dispensary/i.test(type))return null;if(status&&/expired|revoked|surrendered|cancelled|denied/i.test(status))return null;const geo=point(r.georeference??r.location??r.geolocation);const latitude=coord(r.latitude)??geo.latitude,longitude=coord(r.longitude)??geo.longitude;return{name:pick(r,['dbaname','tradename','businessname','licenseename','entityname','name']),streetAddress:pick(r,['premiseaddress','streetaddress','address'])||undefined,city:pick(r,['premisecity','city','municipality'])||undefined,region:'New York',country:'USA',latitude,longitude,website:pick(r,['website','url'])||undefined,licenseNumber:pick(r,['licensenumber','licenseid'])||undefined,dataSource:'New York OCM Current Licenses',sourceUrl,sourceLicense:'Official New York Open Data.',imageryStatus:readiness(latitude,longitude)};}).filter(Boolean).filter((r:any)=>r.name) as CandidateRow[];
}

async function fetchMontana():Promise<CandidateRow[]>{
  const sourceUrl='https://revenue.mt.gov/card/cannabis/cannabis-licenses/lists/dispensary-locations';const html=await getHtml(sourceUrl,'Montana DOR');const rows:CandidateRow[]=[];const tr=/<tr[^>]*>([\s\S]*?)<\/tr>/gi;let m:RegExpExecArray|null;while((m=tr.exec(html))!==null){const cells:string[]=[];const cellRegex=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;let cellMatch:RegExpExecArray|null;while((cellMatch=cellRegex.exec(m[1]))!==null){cells.push(cellMatch[1].replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim());}if(cells.length<3||/licensee.?s name/i.test(cells[0]))continue;const city=cells[1],name=cells[2]||cells[0];if(!name||!city)continue;rows.push({name,city,region:'Montana',country:'USA',dataSource:'Montana DOR Licensed Dispensary Locations',sourceUrl,sourceLicense:'Official Montana Department of Revenue licensed dispensary list.',imageryStatus:'missing_coordinates'});}return rows;
}

const officialSources=[
  {preset:'california-dcc',label:'California DCC',fetcher:fetchCalifornia},
  {preset:'oregon-olcc',label:'Oregon OLCC',fetcher:fetchOregon},
  {preset:'colorado-med',label:'Colorado MED',fetcher:fetchColorado},
  {preset:'massachusetts-ccc',label:'Massachusetts CCC',fetcher:fetchMassachusetts},
  {preset:'nevada-ccb',label:'Nevada CCB',fetcher:fetchNevada},
  {preset:'washington-lcb',label:'Washington LCB',fetcher:fetchWashington},
  {preset:'connecticut-dcp',label:'Connecticut DCP',fetcher:fetchConnecticut},
  {preset:'new-york-ocm',label:'New York OCM',fetcher:fetchNewYork},
  {preset:'montana-dor',label:'Montana DOR',fetcher:fetchMontana},
] as const;

async function syncSource(source:(typeof officialSources)[number]):Promise<SyncDetail>{
  try{const rows=await source.fetcher();if(!rows.length)throw new Error(`${source.label} returned zero valid dispensary records.`);const result=await importCandidates(rows as any[]);const geocoded=rows.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)).length;return{ok:true,source:source.label,fetched:rows.length,added:result.added,geocoded,total:result.total};}catch(error){return{ok:false,source:source.label,fetched:0,added:0,geocoded:0,error:error instanceof Error?error.message:String(error)};}
}

export async function POST(request:NextRequest){
  if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
  const body=await request.json().catch(()=>null);const preset=String(body?.preset||'');
  if(preset==='all'){
    const details:SyncDetail[]=[];
    for(const source of officialSources)details.push(await syncSource(source));
    const successful=details.filter(d=>d.ok),failed=details.filter(d=>!d.ok);
    return NextResponse.json({added:successful.reduce((s,d)=>s+d.added,0),fetched:successful.reduce((s,d)=>s+d.fetched,0),geocoded:successful.reduce((s,d)=>s+d.geocoded,0),total:successful.reduce((m,d)=>Math.max(m,d.total||0),0),details,failed:failed.length,succeeded:successful.length,source:'Official multi-state sync'},{status:successful.length?201:502});
  }
  const source=officialSources.find(item=>item.preset===preset);
  if(!source)return NextResponse.json({error:'Unknown official-data preset.'},{status:400});
  const detail=await syncSource(source);
  if(!detail.ok)return NextResponse.json({error:detail.error,details:[detail]},{status:502});
  return NextResponse.json({...detail,source:source.label},{status:201});
}
