import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { importCandidates } from '@/lib/candidateStore';
import { getDatabase } from '@/lib/sqlite';
import { strongLocationIdentityKeys } from '@/lib/locationIdentity';
import { fetchAlabamaCandidates } from '@/lib/officialSources/alabama';
import { fetchAlaskaCandidates } from '@/lib/officialSources/alaska';
import { fetchArizonaCandidates } from '@/lib/officialSources/arizona';
import { fetchArkansasCandidates } from '@/lib/officialSources/arkansas';
import { fetchBritishColumbiaCandidates } from '@/lib/officialSources/britishColumbia';
import { fetchColoradoCandidates } from '@/lib/officialSources/colorado';
import { fetchConnecticutCandidates } from '@/lib/officialSources/connecticut';
import { fetchDelawareCandidates } from '@/lib/officialSources/delaware';
import { fetchDistrictOfColumbiaCandidates } from '@/lib/officialSources/districtOfColumbia';
import { fetchFloridaCandidates } from '@/lib/officialSources/florida';
import { fetchGeorgiaCandidates } from '@/lib/officialSources/georgia';
import { fetchHawaiiCandidates } from '@/lib/officialSources/hawaii';
import { fetchIllinoisCandidates } from '@/lib/officialSources/illinois';
import { fetchIowaCandidates } from '@/lib/officialSources/iowa';
import { fetchKentuckyCandidates } from '@/lib/officialSources/kentucky';
import { fetchLouisianaCandidates } from '@/lib/officialSources/louisiana';
import { fetchMaineCandidates } from '@/lib/officialSources/maine';
import { fetchMarylandCandidates } from '@/lib/officialSources/maryland';
import { fetchMichiganCandidates } from '@/lib/officialSources/michigan';
import { fetchMinnesotaCandidates } from '@/lib/officialSources/minnesota';
import { fetchMississippiCandidates } from '@/lib/officialSources/mississippi';
import { fetchMissouriCandidates } from '@/lib/officialSources/missouri';
import { fetchNebraskaCandidates } from '@/lib/officialSources/nebraska';
import { fetchNewHampshireCandidates } from '@/lib/officialSources/newHampshire';
import { fetchNewJerseyCandidates } from '@/lib/officialSources/newJersey';
import { fetchNewMexicoCandidates } from '@/lib/officialSources/newMexico';
import { fetchNorthDakotaCandidates } from '@/lib/officialSources/northDakota';
import { fetchOhioCandidates } from '@/lib/officialSources/ohio';
import { fetchOklahomaCandidates } from '@/lib/officialSources/oklahoma';
import { fetchPennsylvaniaCandidates } from '@/lib/officialSources/pennsylvania';
import { fetchSouthDakotaCandidates } from '@/lib/officialSources/southDakota';
import { fetchRhodeIslandCandidates } from '@/lib/officialSources/rhodeIsland';
import { fetchTexasCandidates } from '@/lib/officialSources/texas';
import { fetchUtahCandidates } from '@/lib/officialSources/utah';
import { fetchVermontCandidates } from '@/lib/officialSources/vermont';
import { fetchVirginiaCandidates } from '@/lib/officialSources/virginia';
import { fetchWestVirginiaCandidates } from '@/lib/officialSources/westVirginia';

export const runtime='nodejs';
type CandidateRow={name:string;streetAddress?:string;city?:string;region?:string;country:string;latitude?:number;longitude?:number;website?:string;licenseNumber?:string;dataSource:string;sourceUrl:string;sourceLicense:string;imageryStatus:'unchecked'|'missing_coordinates'};
type SyncMode='check'|'update';
type SyncDetail={ok:boolean;source:string;mode:SyncMode;fetched:number;added:number;existing:number;filled:number;fieldsFilled:number;geocoded:number;duplicates?:number;total?:number;newRecords?:number;matchedApproved?:number;matchedCandidates?:number;changed?:number;missingFromOfficial?:number;missingComparable?:boolean;approvedFilled?:number;approvedFieldsFilled?:number;error?:string};
function key(v:string){return v.toLowerCase().replace(/[^a-z0-9]/g,'');}
function pick(r:Record<string,any>,names:string[]){for(const n of names){const v=r[n];if(v!==undefined&&v!==null&&String(v).trim()!=='')return String(v).trim();}return '';}
function coord(v:unknown){if(v==null||v==='')return undefined;const n=Number(v);return Number.isFinite(n)?n:undefined;}
function readiness(lat?:number,lng?:number){return lat!==undefined&&lng!==undefined?'unchecked' as const:'missing_coordinates' as const;}
function point(v:any){if(!v)return {};if(typeof v==='object')return{latitude:coord(v.latitude??v.lat??v.coordinates?.[1]),longitude:coord(v.longitude??v.lng??v.lon??v.coordinates?.[0])};const m=String(v).match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);return m?{longitude:Number(m[1]),latitude:Number(m[2])}:{};}
function normalizeObject(input:Record<string,any>){const out:Record<string,any>={};for(const [k,v] of Object.entries(input))out[key(k)]=v;return out;}
function parseCsv(text:string){const rows:string[][]=[];let row:string[]=[],field='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(field);field='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);field='';if(row.some(v=>v.trim()))rows.push(row);row=[];}else field+=ch;}if(field||row.length){row.push(field);if(row.some(v=>v.trim()))rows.push(row);}return rows;}
function csvRecords(text:string){const rows=parseCsv(text.replace(/^\uFEFF/,''));if(rows.length<2)return[];const headers=rows[0].map(v=>key(v));return rows.slice(1).map(cells=>{const out:Record<string,string>={};headers.forEach((h,i)=>{if(h)out[h]=String(cells[i]??'').trim();});return out;});}
function browserHeaders(){return{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36','Accept-Language':'en-US,en;q=0.9'};}
async function getJson(url:string){let response:Response;try{response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'GeoWeedo/0.7 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(30000)});}catch(error){throw new Error(`Could not connect to official data source: ${error instanceof Error?error.message:String(error)}`);}if(!response.ok)throw new Error(`Official data source ${new URL(url).host} returned ${response.status}`);return response.json();}
async function getHtml(url:string,label:string){const response=await fetch(url,{headers:browserHeaders(),cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`${label} returned ${response.status}`);return response.text();}
async function fetchCalifornia():Promise<CandidateRow[]>{const sourceUrl='https://search.cannabis.ca.gov/';const api='https://as-dcc-pub-cann-w-p-002.azurewebsites.net/licenses/filteredsearch';const all:any[]=[];let page=1,hasNext=true;while(hasNext&&page<=100){const body:any=await getJson(`${api}?pageSize=500&pageNumber=${page}&searchQuery=`);const data=Array.isArray(body?.data)?body.data:[];all.push(...data);hasNext=Boolean(body?.metadata?.hasNext);page++;}if(hasNext)throw new Error('California DCC sync stopped after 100 pages; refusing a partial import.');return all.map(raw=>normalizeObject(raw)).filter(r=>{const lic=pick(r,['licensenumber','license']),type=pick(r,['licensetype','type']),status=pick(r,['licensestatus','status']);return(/^c10-/i.test(lic)||(/retailer/i.test(type)&&!/nonstorefront|non-storefront|delivery/i.test(type)))&&(/^active\b/i.test(status)||/about to expire/i.test(status));}).map(r=>{const geo=point(r.georeference??r.location??r.geolocation??r.point),latitude=coord(r.premiselatitude??r.latitude)??geo.latitude,longitude=coord(r.premiselongitude??r.longitude)??geo.longitude;return{name:pick(r,['businessdbaname','dbaname','businesslegalname','legalbusinessname','businessname','name']),streetAddress:pick(r,['premisestreetaddress','streetaddress','premiseaddress','address'])||undefined,city:pick(r,['premisecity','city'])||undefined,region:'California',country:'USA',latitude,longitude,website:pick(r,['businesswebsite','website','url'])||undefined,licenseNumber:pick(r,['licensenumber','license'])||undefined,dataSource:'California DCC Unified License Search',sourceUrl,sourceLicense:'Official California Department of Cannabis Control public license-search data; active storefront retailers only.',imageryStatus:readiness(latitude,longitude)};}).filter(r=>r.name);}
async function fetchOregon():Promise<CandidateRow[]>{const sourceUrl='https://data.oregon.gov/d/q32u-cmam',download='https://data.oregon.gov/api/v3/views/q32u-cmam/export.csv?accessType=DOWNLOAD';let response:Response;try{response=await fetch(download,{headers:{Accept:'text/csv,*/*','User-Agent':'GeoWeedo/0.9 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(45000)});}catch(error){throw new Error(`Could not connect to Oregon OLCC official data: ${error instanceof Error?error.message:String(error)}`);}if(!response.ok)throw new Error(`Oregon OLCC official CSV returned ${response.status}`);const records=csvRecords(await response.text()),rows:CandidateRow[]=[];for(const raw of records){const r=normalizeObject(raw),type=pick(r,['licensetype','type']),status=pick(r,['status','licensestatus']),expired=pick(r,['licenseexpired','expired']);if(!/retail/i.test(type))continue;if(status&&!/active|current|issued/i.test(status))continue;if(/yes|true|expired|inactive|revoked|surrendered/i.test(expired))continue;const name=pick(r,['businessname','tradename','businesslicenses','licenseename','name']),licenseNumber=pick(r,['licensenumber','license','licenseid']),addressRaw=pick(r,['physicaladdress','premiseaddress','address']),city=pick(r,['city','physicalcity','premisecity']);const latitude=coord(r.latitude),longitude=coord(r.longitude);if(!name)continue;rows.push({name,streetAddress:addressRaw||undefined,city:city||undefined,region:'Oregon',country:'USA',latitude,longitude,licenseNumber:licenseNumber||undefined,dataSource:'Oregon OLCC Open Data',sourceUrl,sourceLicense:'Official Oregon Open Data cannabis business licenses and endorsements; active retail licenses only.',imageryStatus:readiness(latitude,longitude)});}if(!rows.length)throw new Error('Oregon OLCC v3 export returned zero active retail records; refusing an unverified import.');return rows;}
async function fetchMassachusetts():Promise<CandidateRow[]>{const sourceUrl='https://masscannabiscontrol.com/open-data/data-catalog/';const data:any=await getJson('https://masscannabiscontrol.com/resource/l_licenses_commence_ops.json');return(Array.isArray(data)?data:[]).map((raw:any)=>normalizeObject(raw)).filter(r=>/marijuana retailer/i.test(pick(r,['licensetype']))).map(r=>{const latitude=coord(r.latitude??r.establishmentlatitude),longitude=coord(r.longitude??r.establishmentlongitude);return{name:pick(r,['dbaname','businessname','establishmentname']),streetAddress:pick(r,['establishmentaddress1','businessaddress1'])||undefined,city:pick(r,['establishmentcity','businesscity'])||undefined,region:'Massachusetts',country:'USA',latitude,longitude,licenseNumber:pick(r,['licensenumber','licensenumberbase'])||undefined,dataSource:'Massachusetts CCC Commence Operations',sourceUrl,sourceLicense:'Official Massachusetts Cannabis Control Commission open data; adult-use Marijuana Retailer licenses.',imageryStatus:readiness(latitude,longitude)};}).filter(r=>r.name);}
async function fetchNevada():Promise<CandidateRow[]>{const sourceUrl='https://ccb.nv.gov/list-of-licensees/',html=await getHtml(sourceUrl,'Nevada CCB'),plain=html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' '),rows:CandidateRow[]=[];const re=/([A-Z0-9][A-Z0-9 '&.!/()-]{2,80})\s*[–-]\s*([^|]{5,120}?)\s*[–-]\s*(Adult Use|Medical Only)\s*\|?\s*(\d{15,25})/gi;let m:RegExpExecArray|null;while((m=re.exec(plain))!==null)rows.push({name:m[1].trim(),streetAddress:m[2].trim(),region:'Nevada',country:'USA',licenseNumber:m[4],dataSource:'Nevada CCB Licensed Retail Locations',sourceUrl,sourceLicense:'Official Nevada Cannabis Compliance Board public retail-location list.',imageryStatus:'missing_coordinates'});return rows;}
async function fetchWashington():Promise<CandidateRow[]>{const sourceUrl='https://data.wa.gov/d/brpd-b6zd',data:any=await getJson('https://data.wa.gov/resource/brpd-b6zd.json?$limit=50000');return(Array.isArray(data)?data:[]).map((raw:any)=>normalizeObject(raw)).map(r=>{const geo=point(r.location??r.geolocation??r.point??r.geocodedcolumn),latitude=coord(r.latitude??r.lat)??geo.latitude,longitude=coord(r.longitude??r.lng??r.lon)??geo.longitude,licenseNumber=pick(r,['licensenumber','license','licenseid','licenseidentifier','ubi']);return{name:pick(r,['tradename','businessname','businesslegalname','companyname','licenseename','name'])||`Washington Cannabis Renewal ${licenseNumber}`,streetAddress:pick(r,['streetaddress','address','premiseaddress','locationaddress','physicaladdress'])||undefined,city:pick(r,['city','premisecity','locationcity'])||undefined,region:'Washington',country:'USA',latitude,longitude,licenseNumber:licenseNumber||undefined,dataSource:'Washington LCB Cannabis Renewal Open Data',sourceUrl,sourceLicense:'Official Washington State Liquor and Cannabis Board Cannabis Renewal dataset.',imageryStatus:readiness(latitude,longitude)};}).filter(r=>r.name);}
async function fetchNewYork():Promise<CandidateRow[]>{const sourceUrl='https://data.ny.gov/d/jskf-tt3q',data:any=await getJson('https://data.ny.gov/resource/jskf-tt3q.json?$limit=10000');return(Array.isArray(data)?data:[]).map((raw:any)=>normalizeObject(raw)).filter(r=>!pick(r,['licensetype'])||/retail dispensary|registered organization dispensary/i.test(pick(r,['licensetype']))).map(r=>({name:pick(r,['dba','entityname']),streetAddress:[pick(r,['addressline1']),pick(r,['addressline2'])].filter(Boolean).join(', ')||undefined,city:pick(r,['city'])||undefined,region:'New York',country:'USA',website:pick(r,['businesswebsite'])||undefined,licenseNumber:pick(r,['licensenumber'])||undefined,dataSource:'New York OCM Current Licenses',sourceUrl,sourceLicense:'Official New York Office of Cannabis Management Current OCM Licenses dataset; retail-dispensary records only.',imageryStatus:'missing_coordinates' as const})).filter(r=>r.name);}
async function fetchMontana():Promise<CandidateRow[]>{const sourceUrl='https://revenue.mt.gov/card/cannabis/cannabis-licenses/lists/dispensary-locations',html=await getHtml(sourceUrl,'Montana DOR'),rows:CandidateRow[]=[];const tr=/<tr[^>]*>([\s\S]*?)<\/tr>/gi;let m:RegExpExecArray|null;while((m=tr.exec(html))!==null){const cells:string[]=[];const td=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;let c:RegExpExecArray|null;while((c=td.exec(m[1]))!==null)cells.push(c[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());if(cells.length>=3&&!/licensee.?s name/i.test(cells[0]))rows.push({name:cells[2]||cells[0],city:cells[1],region:'Montana',country:'USA',dataSource:'Montana DOR Licensed Dispensary Locations',sourceUrl,sourceLicense:'Official Montana Department of Revenue licensed dispensary list.',imageryStatus:'missing_coordinates'});}return rows;}

const officialSources=[
 {preset:'alabama-amcc',label:'Alabama AMCC',fetcher:fetchAlabamaCandidates},
 {preset:'alaska-amco',label:'Alaska AMCO',fetcher:fetchAlaskaCandidates},
 {preset:'arizona-adhs',label:'Arizona ADHS',fetcher:fetchArizonaCandidates},
 {preset:'arkansas-mmc',label:'Arkansas MMC',fetcher:fetchArkansasCandidates},
 {preset:'british-columbia-lcrb',label:'British Columbia LCRB',fetcher:fetchBritishColumbiaCandidates},
 {preset:'california-dcc',label:'California DCC',fetcher:fetchCalifornia},
 {preset:'oregon-olcc',label:'Oregon OLCC',fetcher:fetchOregon},
 {preset:'colorado-med',label:'Colorado MED',fetcher:fetchColoradoCandidates},
 {preset:'florida-ommu',label:'Florida OMMU',fetcher:fetchFloridaCandidates},
 {preset:'georgia-gmcc',label:'Georgia GMCC',fetcher:fetchGeorgiaCandidates},
 {preset:'hawaii-doh',label:'Hawaii DOH',fetcher:fetchHawaiiCandidates},
 {preset:'iowa-hhs',label:'Iowa HHS',fetcher:fetchIowaCandidates},
 {preset:'kentucky-kymedcan',label:'Kentucky Medical Cannabis',fetcher:fetchKentuckyCandidates},
 {preset:'louisiana-ldh',label:'Louisiana LDH',fetcher:fetchLouisianaCandidates},
 {preset:'massachusetts-ccc',label:'Massachusetts CCC',fetcher:fetchMassachusetts},
 {preset:'illinois-idfpr',label:'Illinois IDFPR',fetcher:fetchIllinoisCandidates},
 {preset:'mississippi-mmcp',label:'Mississippi MMCP',fetcher:fetchMississippiCandidates},
 {preset:'nebraska-mcc',label:'Nebraska MCC',fetcher:fetchNebraskaCandidates},
 {preset:'nevada-ccb',label:'Nevada CCB',fetcher:fetchNevada},
 {preset:'washington-lcb',label:'Washington LCB',fetcher:fetchWashington},
 {preset:'connecticut-dcp',label:'Connecticut DCP',fetcher:fetchConnecticutCandidates},
 {preset:'district-of-columbia-abca',label:'District of Columbia ABCA',fetcher:fetchDistrictOfColumbiaCandidates},
 {preset:'new-hampshire-dhhs',label:'New Hampshire DHHS',fetcher:fetchNewHampshireCandidates},
 {preset:'new-york-ocm',label:'New York OCM',fetcher:fetchNewYork},
 {preset:'new-mexico-ccd',label:'New Mexico CCD',fetcher:fetchNewMexicoCandidates},
 {preset:'north-dakota-hhs',label:'North Dakota HHS',fetcher:fetchNorthDakotaCandidates},
 {preset:'ohio-dcc',label:'Ohio DCC',fetcher:fetchOhioCandidates},
 {preset:'oklahoma-omma',label:'Oklahoma OMMA',fetcher:fetchOklahomaCandidates},
 {preset:'pennsylvania-doh',label:'Pennsylvania DOH',fetcher:fetchPennsylvaniaCandidates},
 {preset:'south-dakota-doh',label:'South Dakota DOH',fetcher:fetchSouthDakotaCandidates},
 {preset:'texas-dps',label:'Texas DPS',fetcher:fetchTexasCandidates},
 {preset:'utah-udaf',label:'Utah UDAF',fetcher:fetchUtahCandidates},
 {preset:'montana-dor',label:'Montana DOR',fetcher:fetchMontana},
 {preset:'rhode-island-ccc',label:'Rhode Island CCC',fetcher:fetchRhodeIslandCandidates},
 {preset:'vermont-ccb',label:'Vermont CCB',fetcher:fetchVermontCandidates},
 {preset:'virginia-cca',label:'Virginia CCA',fetcher:fetchVirginiaCandidates},
 {preset:'west-virginia-omc',label:'West Virginia OMC',fetcher:fetchWestVirginiaCandidates},
 {preset:'delaware-omc',label:'Delaware OMC',fetcher:fetchDelawareCandidates},
 {preset:'maine-ocp',label:'Maine OCP',fetcher:fetchMaineCandidates},
 {preset:'maryland-mca',label:'Maryland MCA',fetcher:fetchMarylandCandidates},
 {preset:'michigan-cra',label:'Michigan CRA',fetcher:fetchMichiganCandidates},
 {preset:'minnesota-ocm',label:'Minnesota OCM',fetcher:fetchMinnesotaCandidates},
 {preset:'missouri-dhss',label:'Missouri DHSS',fetcher:fetchMissouriCandidates},
 {preset:'new-jersey-crc',label:'New Jersey CRC',fetcher:fetchNewJerseyCandidates}
] as const;
function sourceIdentity(row:CandidateRow){const license=row.licenseNumber?.trim().toLowerCase();if(license)return `license|${row.country.trim().toLowerCase()}|${license}`;return `place|${row.name.trim().toLowerCase()}|${(row.streetAddress||'').trim().toLowerCase()}|${(row.city||'').trim().toLowerCase()}|${(row.region||'').trim().toLowerCase()}`;}
function dedupeSourceRows(rows:CandidateRow[]){const unique=new Map<string,CandidateRow>();for(const row of rows){const identity=sourceIdentity(row);const previous=unique.get(identity);if(!previous){unique.set(identity,row);continue;}unique.set(identity,{...previous,...row,streetAddress:previous.streetAddress||row.streetAddress,city:previous.city||row.city,region:previous.region||row.region,website:previous.website||row.website,licenseNumber:previous.licenseNumber||row.licenseNumber,latitude:Number.isFinite(previous.latitude)?previous.latitude:row.latitude,longitude:Number.isFinite(previous.longitude)?previous.longitude:row.longitude});}return Array.from(unique.values());}
function dbIdentity(row:Record<string,unknown>){return{name:String(row.name||''),streetAddress:String(row.street_address||''),city:String(row.city||''),region:String(row.region||''),country:String(row.country||''),latitude:row.latitude==null?undefined:Number(row.latitude),longitude:row.longitude==null?undefined:Number(row.longitude),website:String(row.website||''),licenseNumber:String(row.license_number||'')};}
function cmp(v:unknown){return String(v??'').normalize('NFKD').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');}
function cmpLicense(v:unknown){return String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,'');}
function cmpStreet(v:unknown){return cmp(String(v??'').split(',')[0]).replace(/\b(?:suite|ste|unit|apt|apartment)\s+[a-z0-9-]+\b/g,'').replace(/\b(street|st)\b/g,'st').replace(/\b(road|rd)\b/g,'rd').replace(/\b(avenue|ave)\b/g,'ave').replace(/\b(boulevard|blvd)\b/g,'blvd').replace(/\b(drive|dr)\b/g,'dr').replace(/\b(highway|hwy)\b/g,'hwy').replace(/\s+/g,' ').trim();}
function different(current:Record<string,unknown>,incoming:CandidateRow){
 const currentLicense=cmpLicense(current.license_number),incomingLicense=cmpLicense(incoming.licenseNumber);
 if(currentLicense&&incomingLicense&&currentLicense!==incomingLicense)return true;
 const currentCity=cmp(current.city),incomingCity=cmp(incoming.city);
 if(currentCity&&incomingCity&&currentCity!==incomingCity)return true;
 const currentStreet=cmpStreet(current.street_address),incomingStreet=cmpStreet(incoming.streetAddress);
 if(currentStreet&&incomingStreet&&currentStreet!==incomingStreet)return true;
 return false;
}
function compareRows(rows:CandidateRow[]){
 const db=getDatabase();
 const approved=db.prepare('SELECT id,name,street_address,city,region,country,latitude,longitude,website,license_number,data_source,source_url FROM dispensaries').all() as Record<string,unknown>[];
 const candidates=db.prepare("SELECT id,name,street_address,city,region,country,latitude,longitude,website,license_number,data_source,source_url FROM dispensary_candidates WHERE status<>'rejected'").all() as Record<string,unknown>[];
 const approvedMap=new Map<string,Record<string,unknown>>(),candidateMap=new Map<string,Record<string,unknown>>();
 for(const row of approved)for(const key of strongLocationIdentityKeys(dbIdentity(row)))if(!approvedMap.has(key))approvedMap.set(key,row);
 for(const row of candidates)for(const key of strongLocationIdentityKeys(dbIdentity(row)))if(!candidateMap.has(key))candidateMap.set(key,row);
 let newRecords=0,matchedApproved=0,matchedCandidates=0,changed=0;
 for(const row of rows){
  const keys=strongLocationIdentityKeys(row);
  const approvedMatch=keys.map(key=>approvedMap.get(key)).find(Boolean);
  const candidateMatch=keys.map(key=>candidateMap.get(key)).find(Boolean);
  const match=approvedMatch||candidateMatch;
  if(!match){newRecords++;continue;}
  if(approvedMatch)matchedApproved++;else matchedCandidates++;
  if(different(match,row))changed++;
 }
 const officialLicenses=new Set(rows.map(row=>cmpLicense(row.licenseNumber)).filter(Boolean));
 const missingComparable=rows.length>0&&officialLicenses.size/rows.length>=.8;
 let missingFromOfficial=0;
 if(missingComparable){
  const sourceNames=new Set(rows.map(row=>row.dataSource).filter(Boolean));
  const sourceUrls=new Set(rows.map(row=>row.sourceUrl).filter(Boolean) as string[]);
  const existingLicenses=new Set<string>();
  for(const row of [...approved,...candidates]){
   if(!sourceNames.has(String(row.data_source||''))&&!sourceUrls.has(String(row.source_url||'')))continue;
   const license=cmpLicense(row.license_number);
   if(license)existingLicenses.add(license);
  }
  for(const license of existingLicenses)if(!officialLicenses.has(license))missingFromOfficial++;
 }
 return{newRecords,matchedApproved,matchedCandidates,changed,missingFromOfficial,missingComparable};
}
function fillApprovedBlanks(rows:CandidateRow[]){const db=getDatabase();const approved=db.prepare('SELECT * FROM dispensaries').all() as Record<string,unknown>[];const map=new Map<string,Record<string,unknown>>();for(const row of approved)for(const key of strongLocationIdentityKeys(dbIdentity(row)))if(!map.has(key))map.set(key,row);const update=db.prepare(`UPDATE dispensaries SET street_address=CASE WHEN street_address IS NULL OR trim(street_address)='' THEN COALESCE(?,street_address) ELSE street_address END,website=CASE WHEN website IS NULL OR trim(website)='' THEN COALESCE(?,website) ELSE website END,license_number=CASE WHEN license_number IS NULL OR trim(license_number)='' THEN COALESCE(?,license_number) ELSE license_number END,data_source=CASE WHEN data_source IS NULL OR trim(data_source)='' THEN COALESCE(?,data_source) ELSE data_source END,source_url=CASE WHEN source_url IS NULL OR trim(source_url)='' THEN COALESCE(?,source_url) ELSE source_url END,source_license=CASE WHEN source_license IS NULL OR trim(source_license)='' THEN COALESCE(?,source_license) ELSE source_license END,updated_at=? WHERE id=?`);let approvedFilled=0,approvedFieldsFilled=0;const now=new Date().toISOString();for(const row of rows){const match=strongLocationIdentityKeys(row).map(key=>map.get(key)).find(Boolean);if(!match)continue;const incoming=[row.streetAddress,row.website,row.licenseNumber,row.dataSource,row.sourceUrl,row.sourceLicense];const existing=[match.street_address,match.website,match.license_number,match.data_source,match.source_url,match.source_license];const count=incoming.filter((value,index)=>value!=null&&String(value).trim()!==''&&(existing[index]==null||String(existing[index]).trim()==='')).length;if(!count)continue;update.run(row.streetAddress??null,row.website??null,row.licenseNumber??null,row.dataSource||null,row.sourceUrl??null,row.sourceLicense??null,now,String(match.id));approvedFilled++;approvedFieldsFilled+=count;}return{approvedFilled,approvedFieldsFilled};}
async function syncSource(source:(typeof officialSources)[number],mode:SyncMode):Promise<SyncDetail>{try{const rawRows=await source.fetcher() as CandidateRow[];if(!rawRows.length)throw new Error(`${source.label} returned zero valid dispensary records.`);const rows=dedupeSourceRows(rawRows),duplicates=rawRows.length-rows.length,comparison=compareRows(rows);if(mode==='check')return{ok:true,source:source.label,mode,fetched:rows.length,duplicates,added:0,existing:comparison.matchedApproved+comparison.matchedCandidates,filled:0,fieldsFilled:0,geocoded:rows.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)).length,...comparison};const result=await importCandidates(rows as any[]),approved=fillApprovedBlanks(rows);return{ok:true,source:source.label,mode,fetched:rows.length,duplicates,added:result.added,existing:result.existing,filled:result.filled+approved.approvedFilled,fieldsFilled:result.fieldsFilled+approved.approvedFieldsFilled,approvedFilled:approved.approvedFilled,approvedFieldsFilled:approved.approvedFieldsFilled,geocoded:rows.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)).length,total:result.total,...comparison};}catch(error){return{ok:false,source:source.label,mode,fetched:0,duplicates:0,added:0,existing:0,filled:0,fieldsFilled:0,geocoded:0,error:error instanceof Error?error.message:String(error)};}}
export async function POST(request:NextRequest){if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});const body=await request.json().catch(()=>null),preset=String(body?.preset||''),mode:SyncMode=body?.mode==='check'?'check':'update';const automated=officialSources.filter(item=>item.preset!=='alaska-amco'&&item.preset!=='mississippi-mmcp'&&item.preset!=='nebraska-mcc'&&item.preset!=='new-mexico-ccd'&&item.preset!=='oklahoma-omma'&&item.preset!=='british-columbia-lcrb');if(preset==='all'){const details:SyncDetail[]=[];for(const source of automated)details.push(await syncSource(source,mode));const successful=details.filter(d=>d.ok);return NextResponse.json({mode,added:successful.reduce((s,d)=>s+d.added,0),existing:successful.reduce((s,d)=>s+d.existing,0),filled:successful.reduce((s,d)=>s+d.filled,0),fieldsFilled:successful.reduce((s,d)=>s+d.fieldsFilled,0),fetched:successful.reduce((s,d)=>s+d.fetched,0),newRecords:successful.reduce((s,d)=>s+(d.newRecords||0),0),changed:successful.reduce((s,d)=>s+(d.changed||0),0),missingFromOfficial:successful.filter(d=>d.missingComparable).reduce((s,d)=>s+(d.missingFromOfficial||0),0),missingComparedSources:successful.filter(d=>d.missingComparable).length,missingUnavailableSources:successful.filter(d=>!d.missingComparable).length,duplicates:successful.reduce((s,d)=>s+(d.duplicates||0),0),geocoded:successful.reduce((s,d)=>s+d.geocoded,0),details,failed:details.length-successful.length,succeeded:successful.length,skipped:[{source:'Alaska AMCO',reason:'Temporarily unavailable for automated sync while Alaska transitions public licensing search to AK-ACCIS.'},{source:'Mississippi MMCP',reason:'Temporarily unavailable for automated sync because the official MMCP Business Search is browser-accessible but is timing out from the GeoWeedo production server.'},{source:'Nebraska MCC',reason:'Nebraska is integrated, but MCC has not yet published an official licensed/operational dispensary roster. GeoWeedo will not create storefronts from applicants, cultivators, hemp businesses, or other non-dispensary records.'},{source:'New Mexico CCD',reason:'Temporarily unavailable for automated sync because the current CCD public search does not expose a reliable machine-readable retailer roster.'},{source:'Oklahoma OMMA',reason:'Temporarily unavailable for automated bulk sync because OMMA publishes current dispensary totals and per-license verification, but not a public machine-readable bulk roster of active dispensary names and addresses.'}],source:'Official United States registry'},{status:successful.length?(mode==='check'?200:201):502});}const source=officialSources.find(item=>item.preset===preset);if(!source)return NextResponse.json({error:'Unknown official-source preset.'},{status:400});const detail=await syncSource(source,mode);if(!detail.ok)return NextResponse.json({error:detail.error,details:[detail]},{status:502});return NextResponse.json({...detail,details:[detail]},{status:mode==='check'?200:201});}
