import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { importCandidates } from '@/lib/candidateStore';

export const runtime = 'nodejs';

type CandidateRow = {
  name: string; streetAddress?: string; city?: string; region?: string; country: string;
  latitude?: number; longitude?: number; website?: string; licenseNumber?: string;
  dataSource: string; sourceUrl: string; sourceLicense: string; imageryStatus: 'unchecked' | 'missing_coordinates';
};

type DccResponse = { data?: unknown[]; metadata?: { hasNext?: boolean; totalPages?: number } };

function parseCsvLine(line: string) { const values:string[]=[]; let value=''; let quoted=false; for(let i=0;i<line.length;i++){const char=line[i]; if(char==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(char===','&&!quoted){values.push(value.trim());value='';}else value+=char;} values.push(value.trim()); return values; }
function key(value:string){return value.toLowerCase().replace(/[^a-z0-9]/g,'');}
function pick(row:Record<string,any>, names:string[]){for(const name of names){const value=row[name]; if(value!==undefined&&value!==null&&String(value).trim()!=='') return String(value).trim();} return '';}
function coord(value:unknown){if(value==null||value==='')return undefined; const n=Number(value); return Number.isFinite(n)?n:undefined;}
function readiness(latitude?:number,longitude?:number){return latitude!==undefined&&longitude!==undefined?'unchecked' as const:'missing_coordinates' as const;}
function point(value:any){if(!value)return {}; if(typeof value==='object'){const latitude=coord(value.latitude??value.lat??value.coordinates?.[1]); const longitude=coord(value.longitude??value.lng??value.lon??value.coordinates?.[0]); return {latitude,longitude};} const m=String(value).match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i); return m?{longitude:Number(m[1]),latitude:Number(m[2])}:{};}
function normalizeObject(input:Record<string,any>){const out:Record<string,any>={}; for(const [k,v] of Object.entries(input))out[key(k)]=v; return out;}
async function getJson(url:string){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'GeoWeedo/0.5 (https://geoweedo.yerbas.org)'},cache:'no-store'}); if(!r.ok)throw new Error(`Official data source returned ${r.status}`); return r.json();}

async function fetchCalifornia():Promise<CandidateRow[]>{
  const sourceUrl='https://search.cannabis.ca.gov/';
  const api='https://as-cdt-pub-vip-cannabis-ww-p-002.azurewebsites.net/licenses/filteredSearch';
  const all:any[]=[];
  const pageSize=500;
  let page=1;
  let hasNext=true;
  while(hasNext&&page<=100){
    const url=`${api}?pageSize=${pageSize}&pageNumber=${page}&searchQuery=`;
    const body=await getJson(url) as DccResponse;
    const data=Array.isArray(body?.data)?body.data:[];
    all.push(...data);
    hasNext=Boolean(body?.metadata?.hasNext);
    page++;
  }
  if(hasNext)throw new Error('California DCC sync stopped after 100 pages; refusing a partial import.');
  if(!all.length)throw new Error('California DCC returned no license records.');

  const rows=all.map(raw=>normalizeObject(raw as Record<string,any>)).filter(r=>{
    const licenseNumber=pick(r,['licensenumber','license']);
    const type=pick(r,['licensetype','type']);
    const status=pick(r,['licensestatus','status']);
    const storefront=/^c10-/i.test(licenseNumber)||(/retailer/i.test(type)&&!/nonstorefront|non-storefront|delivery/i.test(type));
    const active=/^active\b/i.test(status)||/about to expire/i.test(status);
    return storefront&&active;
  }).map(r=>{
    const geo=point(r.georeference??r.location??r.geolocation??r.point);
    const latitude=coord(r.premiselatitude??r.latitude)??geo.latitude;
    const longitude=coord(r.premiselongitude??r.longitude)??geo.longitude;
    const name=pick(r,['businessdbaname','dbaname','businesslegalname','legalbusinessname','businessname','name']);
    return {
      name,
      streetAddress:pick(r,['premisestreetaddress','streetaddress','premiseaddress','address'])||undefined,
      city:pick(r,['premisecity','city'])||undefined,
      region:'California',
      country:'USA',
      latitude,
      longitude,
      website:pick(r,['businesswebsite','website','url'])||undefined,
      licenseNumber:pick(r,['licensenumber','license'])||undefined,
      dataSource:'California DCC Unified License Search',
      sourceUrl,
      sourceLicense:'Official California Department of Cannabis Control public license-search data; active storefront retailers only.',
      imageryStatus:readiness(latitude,longitude),
    };
  }).filter(r=>r.name);

  const unique=new Map<string,CandidateRow>();
  for(const row of rows){const id=row.licenseNumber||`${row.name}|${row.streetAddress||''}|${row.city||''}`; if(!unique.has(id))unique.set(id,row);}
  if(!unique.size)throw new Error('California DCC responded, but no active storefront retailer records matched the expected C10/type fields.');
  return Array.from(unique.values());
}

async function fetchOregon():Promise<CandidateRow[]>{
  const sourceUrl='https://data.oregon.gov/Business/OLCC-Cannabis-Business-Licenses-Endorsements/q32u-cmam';
  const data=await getJson('https://data.oregon.gov/resource/q32u-cmam.json?$limit=5000');
  return (Array.isArray(data)?data:[]).filter((r:any)=>String(r.license_type||'').toLowerCase().includes('retail')&&!String(r.license_expired||'').toLowerCase().includes('yes')).map((r:any)=>{const latitude=coord(r.latitude),longitude=coord(r.longitude);return{name:String(r.business_name||r.business_licenses||'').trim(),streetAddress:String(r.physical_address||'').trim()||undefined,region:'Oregon',country:'USA',latitude,longitude,licenseNumber:String(r.license_number||'').trim()||undefined,dataSource:'Oregon OLCC Open Data',sourceUrl,sourceLicense:'Official Oregon Open Data.',imageryStatus:readiness(latitude,longitude)};}).filter((r:any)=>r.name);
}

async function fetchNevada():Promise<CandidateRow[]>{
  const sourceUrl='https://ccb.nv.gov/list-of-licensees/'; const response=await fetch(sourceUrl,{headers:{Accept:'text/html','User-Agent':'GeoWeedo/0.5 (https://geoweedo.yerbas.org)'},cache:'no-store'}); if(!response.ok)throw new Error(`Nevada CCB returned ${response.status}`); const html=await response.text(); const plain=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#8211;|&ndash;/g,'–').replace(/&nbsp;/g,' ').replace(/\s+/g,' '); const rows:CandidateRow[]=[]; const regex=/([A-Z0-9][A-Z0-9 '&.!/()-]{2,80})\s*[–-]\s*([^|]{5,120}?)\s*[–-]\s*(Adult Use|Medical Only)\s*\|?\s*(\d{15,25})/gi; let m:RegExpExecArray|null; while((m=regex.exec(plain))!==null){const name=m[1].trim().replace(/^Y\s+|^N\s+/i,''),licenseNumber=m[4].trim(); if(!name||rows.some(r=>r.licenseNumber===licenseNumber))continue; rows.push({name,streetAddress:m[2].trim(),region:'Nevada',country:'USA',licenseNumber,dataSource:'Nevada CCB Licensed Retail Locations',sourceUrl,sourceLicense:'Official Nevada Cannabis Compliance Board public retail-location list.',imageryStatus:'missing_coordinates'});} if(!rows.length)throw new Error('Nevada CCB page format changed; no retail rows could be parsed.'); return rows;
}

async function fetchWashington():Promise<CandidateRow[]>{
  const sourceUrl='https://data.wa.gov/d/brpd-b6zd'; const response=await fetch('https://data.wa.gov/api/v3/views/brpd-b6zd/export.csv?accessType=DOWNLOAD',{headers:{Accept:'text/csv','User-Agent':'GeoWeedo/0.5 (https://geoweedo.yerbas.org)'},cache:'no-store'}); if(!response.ok)throw new Error(`Washington Open Data returned ${response.status}`); const text=await response.text(); const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.trim()); if(lines.length<2)return []; const headers=parseCsvLine(lines[0]).map(key); return lines.slice(1).map(line=>{const values=parseCsvLine(line),row:Record<string,string>={};headers.forEach((h,i)=>row[h]=values[i]||''); const type=pick(row,['licensetype','privilege','endorsement','license']); const latitude=coord(pick(row,['latitude','lat'])),longitude=coord(pick(row,['longitude','lng','lon','long'])); return {name:pick(row,['tradename','businessname','applicantname','licenseename','name']),streetAddress:pick(row,['address','streetaddress','premiseaddress','locationaddress'])||undefined,city:pick(row,['city','premisecity','locationcity'])||undefined,region:pick(row,['state','region'])||'Washington',country:'USA',latitude,longitude,licenseNumber:pick(row,['licensenumber','licenseid','license'])||undefined,dataSource:'Washington LCB Cannabis Renewal Open Data',sourceUrl,sourceLicense:'Official Washington Open Data.',imageryStatus:readiness(latitude,longitude),_type:type};}).filter((r:any)=>r.name&&(!r._type||/cannabis|marijuana|retail/i.test(r._type))).map(({_type,...r}:any)=>r);
}

async function fetchConnecticut():Promise<CandidateRow[]>{
  const sourceUrl='https://data.ct.gov/d/42yd-3x3d'; const data=await getJson('https://data.ct.gov/resource/42yd-3x3d.json?$limit=5000');
  return (Array.isArray(data)?data:[]).map((raw:any)=>{const r=normalizeObject(raw); const geo=point(r.geocodedcolumn??r.location??r.geolocation??r.point); const latitude=coord(r.latitude)??geo.latitude, longitude=coord(r.longitude)??geo.longitude; return {name:pick(r,['dbaname','doingbusinessas','businessname','facilityname','name','licenseename']),streetAddress:pick(r,['streetaddress','address','premiseaddress'])||undefined,city:pick(r,['city','town'])||undefined,region:'Connecticut',country:'USA',latitude,longitude,website:pick(r,['website','url'])||undefined,licenseNumber:pick(r,['licensenumber','credentialnumber','licenseid'])||undefined,dataSource:'Connecticut DCP Licensed Cannabis Retail Locations',sourceUrl,sourceLicense:'Official Connecticut Open Data.',imageryStatus:readiness(latitude,longitude)};}).filter((r:any)=>r.name);
}

async function fetchNewYork():Promise<CandidateRow[]>{
  const sourceUrl='https://data.ny.gov/d/jskf-tt3q'; const data=await getJson('https://data.ny.gov/resource/jskf-tt3q.json?$limit=10000');
  return (Array.isArray(data)?data:[]).map((raw:any)=>{const r=normalizeObject(raw); const type=pick(r,['licensetype','licensecategory','type']); const status=pick(r,['licensestatus','status']); if(type&&!/retail|dispensary/i.test(type))return null; if(status&&/expired|revoked|surrendered|cancelled|denied/i.test(status))return null; const geo=point(r.georeference??r.location??r.geolocation); const latitude=coord(r.latitude)??geo.latitude,longitude=coord(r.longitude)??geo.longitude; return {name:pick(r,['dbaname','tradename','businessname','licenseename','entityname','name']),streetAddress:pick(r,['premiseaddress','streetaddress','address'])||undefined,city:pick(r,['premisecity','city','municipality'])||undefined,region:'New York',country:'USA',latitude,longitude,website:pick(r,['website','url'])||undefined,licenseNumber:pick(r,['licensenumber','licenseid'])||undefined,dataSource:'New York OCM Current Licenses',sourceUrl,sourceLicense:'Official New York Open Data.',imageryStatus:readiness(latitude,longitude)};}).filter(Boolean).filter((r:any)=>r.name) as CandidateRow[];
}

async function fetchMontana():Promise<CandidateRow[]>{
  const sourceUrl='https://revenue.mt.gov/card/cannabis/cannabis-licenses/lists/dispensary-locations'; const response=await fetch(sourceUrl,{headers:{Accept:'text/html','User-Agent':'GeoWeedo/0.5 (https://geoweedo.yerbas.org)'},cache:'no-store'}); if(!response.ok)throw new Error(`Montana DOR returned ${response.status}`); const html=await response.text(); const rows:CandidateRow[]=[]; const tr=/<tr[^>]*>([\s\S]*?)<\/tr>/gi; let m:RegExpExecArray|null; while((m=tr.exec(html))!==null){const cells:string[]=[]; const cellRegex=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi; let cellMatch:RegExpExecArray|null; while((cellMatch=cellRegex.exec(m[1]))!==null){cells.push(cellMatch[1].replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim());} if(cells.length<3||/licensee.?s name/i.test(cells[0]))continue; const name=cells[2]||cells[0],city=cells[1]; if(!name||!city)continue; rows.push({name,city,region:'Montana',country:'USA',dataSource:'Montana DOR Licensed Dispensary Locations',sourceUrl,sourceLicense:'Official Montana Department of Revenue public dispensary list.',imageryStatus:'missing_coordinates'});} if(!rows.length)throw new Error('Montana DOR page format changed; no dispensary rows could be parsed.'); return rows;
}

const officialSources=[
  {preset:'california-dcc',label:'California DCC',fetcher:fetchCalifornia},
  {preset:'oregon-olcc',label:'Oregon OLCC',fetcher:fetchOregon},
  {preset:'nevada-ccb',label:'Nevada CCB',fetcher:fetchNevada},
  {preset:'washington-lcb',label:'Washington LCB',fetcher:fetchWashington},
  {preset:'connecticut-dcp',label:'Connecticut DCP',fetcher:fetchConnecticut},
  {preset:'new-york-ocm',label:'New York OCM',fetcher:fetchNewYork},
  {preset:'montana-dor',label:'Montana DOR',fetcher:fetchMontana},
] as const;

export async function POST(request:NextRequest){
  if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401}); const body=await request.json().catch(()=>null); const preset=String(body?.preset||'');
  try{
    if(preset==='all'){
      const settled=await Promise.allSettled(officialSources.map(async source=>{const rows=await source.fetcher(); const result=await importCandidates(rows as any[]); const geocoded=rows.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)).length; return {source:source.label,fetched:rows.length,added:result.added,geocoded,total:result.total};}));
      const details=settled.map((result,index)=>result.status==='fulfilled'?{ok:true,...result.value}:{ok:false,source:officialSources[index].label,fetched:0,added:0,geocoded:0,error:result.reason instanceof Error?result.reason.message:String(result.reason)}); const successful=details.filter(d=>d.ok) as any[],failed=details.filter(d=>!d.ok); return NextResponse.json({added:successful.reduce((s,d)=>s+d.added,0),fetched:successful.reduce((s,d)=>s+d.fetched,0),geocoded:successful.reduce((s,d)=>s+d.geocoded,0),total:successful.reduce((m,d)=>Math.max(m,d.total||0),0),details,failed:failed.length,source:'Official multi-state sync'},{status:failed.length===officialSources.length?502:201});
    }
    const source=officialSources.find(item=>item.preset===preset); if(!source)return NextResponse.json({error:'Unknown official-data preset.'},{status:400}); const rows=await source.fetcher(); const result=await importCandidates(rows as any[]); const geocoded=rows.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)).length; return NextResponse.json({...result,fetched:rows.length,geocoded,source:source.label},{status:201});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Official-data fetch failed.'},{status:502});}
}
