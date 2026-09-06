import 'server-only';

type Row={
 name:string;
 streetAddress?:string;
 city?:string;
 region:string;
 country:string;
 latitude?:number;
 longitude?:number;
 website?:string;
 licenseNumber?:string;
 dataSource:string;
 sourceUrl:string;
 sourceLicense:string;
 imageryStatus:'unchecked'|'missing_coordinates';
};

type LayerRef={url:string;label:string};
type ArcItem={id:string;type?:string;title?:string;url?:string;owner?:string;tags?:string[];description?:string;snippet?:string};

const CRA_HOME='https://www.michigan.gov/cra';
const CRA_VERIFY='https://www.michigan.gov/cra/verify-a-license-1';
const CRA_MEDICAL='https://www.michigan.gov/cra/sections/mmfl';
const CRA_ADULT='https://www.michigan.gov/cra/sections/adult-use';
const LEGACY_APP_ID='cd5a1a76daaf470b823a382691c0ff60';
const ARCGIS='https://www.arcgis.com/sharing/rest/content/items';
const ARCGIS_SEARCH='https://www.arcgis.com/sharing/rest/search';
const RETAIL_RE=/mari(?:j|h)uana\s+retailer|adult[- ]use.*retailer|provisioning\s+center|cannabis\s+retailer/i;

function clean(value:unknown){return String(value??'').replace(/&amp;/g,'&').replace(/&#39;|&apos;|&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function key(value:string){return value.toLowerCase().replace(/[^a-z0-9]/g,'');}
function normalized(input:Record<string,unknown>){const out:Record<string,unknown>={};for(const [name,value] of Object.entries(input||{}))out[key(name)]=value;return out;}
function pick(row:Record<string,unknown>,names:string[]){for(const name of names){const value=row[key(name)];if(value!==undefined&&value!==null&&clean(value))return clean(value);}return '';}
function number(value:unknown){if(value===undefined||value===null||value==='')return undefined;const n=Number(value);return Number.isFinite(n)?n:undefined;}
function readiness(lat?:number,lng?:number){return lat!==undefined&&lng!==undefined?'unchecked' as const:'missing_coordinates' as const;}
function parseAddress(value:string){const address=clean(value);const match=address.match(/^(.*?)(?:,\s*|\s+)([A-Za-z .'-]{2,60}),?\s+MI\s+(\d{5}(?:-\d{4})?)(?:\s+United States)?$/i);return{streetAddress:address||undefined,city:match?.[2]?.trim()};}

async function getJson(url:string,label:string){let response:Response;try{response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'GeoWeedo/0.4 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(20000)});}catch(error){throw new Error(`${label} request failed: ${error instanceof Error?error.message:String(error)}`);}if(!response.ok)throw new Error(`${label} returned HTTP ${response.status}`);const body=await response.json();if(body?.error)throw new Error(`${label} returned ArcGIS error ${body.error.code||''}: ${body.error.message||'unknown error'}`);return body;}

async function getText(url:string,label:string){let response:Response;try{response=await fetch(url,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'GeoWeedo/0.4 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(20000)});}catch(error){throw new Error(`${label} request failed: ${error instanceof Error?error.message:String(error)}`);}if(!response.ok)throw new Error(`${label} returned HTTP ${response.status}`);return response.text();}

function findWebMapId(app:any){const candidates=[app?.map?.itemId,app?.map?.webMapId,app?.values?.webmap,app?.values?.webMap,app?.webmap,app?.webMapId];for(const value of candidates){if(typeof value==='string'&&/^[a-f0-9]{32}$/i.test(value))return value;}const text=JSON.stringify(app);const re=/(?:webmap|webMap|itemId)[^a-f0-9]{0,20}([a-f0-9]{32})/gi;let match:RegExpExecArray|null;while((match=re.exec(text))!==null){if(match[1])return match[1];}return undefined;}

function collectLayerRefs(value:any,out:LayerRef[]=[],parent=''):LayerRef[]{if(!value)return out;if(Array.isArray(value)){for(const item of value)collectLayerRefs(item,out,parent);return out;}if(typeof value!=='object')return out;const label=clean(value.title||value.name||parent);if(typeof value.url==='string'&&/\/FeatureServer(?:\/\d+)?\/?$/i.test(value.url))out.push({url:value.url.replace(/\/$/,''),label});for(const [name,child] of Object.entries(value))collectLayerRefs(child,out,label||name);return out;}

async function expandLayers(ref:LayerRef):Promise<LayerRef[]>{if(/\/FeatureServer\/\d+$/i.test(ref.url))return[ref];const meta=await getJson(`${ref.url}?f=json`,'Michigan CRA ArcGIS service metadata');const layers=Array.isArray(meta.layers)?meta.layers:[];return layers.map((layer:any)=>({url:`${ref.url}/${layer.id}`,label:clean(layer.name||ref.label)}));}

async function queryLayer(layer:LayerRef){const features:any[]=[];let offset=0;for(let page=0;page<20;page++){const params=new URLSearchParams({where:'1=1',outFields:'*',returnGeometry:'true',outSR:'4326',f:'json',resultOffset:String(offset),resultRecordCount:'2000'});const body=await getJson(`${layer.url}/query?${params.toString()}`,`Michigan CRA ArcGIS layer ${layer.label||layer.url}`);const batch=Array.isArray(body.features)?body.features:[];features.push(...batch);if(!body.exceededTransferLimit||batch.length===0)break;offset+=batch.length;}return features;}

function featureToRow(feature:any,layerLabel:string,sourceUrl:string):Row|null{const attrs=normalized(feature?.attributes||{});const type=pick(attrs,['License Type','Record Type','Type','Facility Type','LicenseType','Category'])||layerLabel;const licenseNumber=pick(attrs,['License Number','License #','Record Number','Record #','LicenseNumber','License_ID','License ID']);const haystack=`${layerLabel} ${type} ${licenseNumber}`;
 if(!RETAIL_RE.test(haystack)&&!/^AU-R-/i.test(licenseNumber))return null;
 const status=pick(attrs,['Status','Record Status','License Status','LicenseStatus']);if(status&&!/active|approved|current/i.test(status))return null;
 const name=pick(attrs,['DBA','DBA Name','Doing Business As','License Name','Licensee Name','Business Name','Facility Name','Establishment Name','Name']);if(!name)return null;
 const rawAddress=pick(attrs,['Address','Street Address','Facility Address','Physical Address','Location Address','Premise Address']);const parsed=parseAddress(rawAddress);const city=pick(attrs,['City','Facility City','Physical City','Premise City'])||parsed.city;
 const geometry=feature?.geometry||{};const latitude=number(geometry.y??attrs.latitude??attrs.lat),longitude=number(geometry.x??attrs.longitude??attrs.lng??attrs.lon);
 if(latitude!==undefined&&(latitude<41.5||latitude>49.0))return null;if(longitude!==undefined&&(longitude<-91.0||longitude>-82.0))return null;
 const website=pick(attrs,['Website','Web Site','URL','Business Website'])||undefined;
 return{name,streetAddress:parsed.streetAddress,city:city||undefined,region:'Michigan',country:'USA',latitude,longitude,website,licenseNumber:licenseNumber||undefined,dataSource:'Michigan CRA Active Cannabis Business Map',sourceUrl,sourceLicense:'Official Michigan Cannabis Regulatory Agency public facility-map data; adult-use Marijuana/Cannabis Retailer and medical Provisioning Center locations only.',imageryStatus:readiness(latitude,longitude)};
}

function idsFromHtml(html:string){const ids=new Set<string>();const patterns=[/michigan\.maps\.arcgis\.com\/apps\/[^"'<>\s?]+[^"'<>\s]*[?&]id=([a-f0-9]{32})/gi,/[?&]id=([a-f0-9]{32})/gi,/\b([a-f0-9]{32})\b/gi];for(const pattern of patterns){let match:RegExpExecArray|null;while((match=pattern.exec(html))!==null){if(match[1])ids.add(match[1]);}}return Array.from(ids);}

async function discoverCraPublishedIds(){const ids=new Set<string>();const pages=[CRA_HOME,CRA_VERIFY,CRA_MEDICAL,CRA_ADULT];for(const page of pages){try{const html=await getText(page,'Michigan CRA source page');for(const id of idsFromHtml(html))ids.add(id);}catch{/* Continue to the next official CRA page. */}}ids.add(LEGACY_APP_ID);return Array.from(ids);}

function relevantArcItem(item:ArcItem){const haystack=[item.title,item.owner,item.description,item.snippet,...(item.tags||[])].map(clean).join(' ');return /michigan/i.test(haystack)&&/cannabis|mari(?:j|h)uana/i.test(haystack)&&/facility|business|license|retail|regulatory|cra/i.test(haystack);}

async function searchArcgisCandidates(){const queries=['Michigan cannabis facility','Michigan marijuana facility','Michigan marihuana retailer','Michigan Cannabis Regulatory Agency'];const found=new Map<string,ArcItem>();for(const q of queries){try{const params=new URLSearchParams({f:'json',num:'100',sortField:'modified',sortOrder:'desc',q});const body=await getJson(`${ARCGIS_SEARCH}?${params.toString()}`,'Michigan CRA ArcGIS discovery search');for(const item of Array.isArray(body.results)?body.results:[]){if(item?.id&&relevantArcItem(item))found.set(item.id,item);}}catch{/* Try the remaining discovery queries. */}}return Array.from(found.values());}

async function layerRefsFromItem(item:ArcItem):Promise<{refs:LayerRef[];sourceUrl:string}> {const type=clean(item.type);const sourceUrl=item.url||`https://www.arcgis.com/home/item.html?id=${item.id}`;if(/feature service/i.test(type)&&item.url&&/\/FeatureServer(?:\/\d+)?\/?$/i.test(item.url))return{refs:[{url:item.url.replace(/\/$/,''),label:clean(item.title)}],sourceUrl};if(/web map/i.test(type)){const map=await getJson(`${ARCGIS}/${item.id}/data?f=json`,'Michigan CRA ArcGIS web map');return{refs:collectLayerRefs(map),sourceUrl};}const app=await getJson(`${ARCGIS}/${item.id}/data?f=json`,'Michigan CRA ArcGIS application');const webMapId=findWebMapId(app);if(!webMapId)throw new Error('application did not expose a public web-map item id');const map=await getJson(`${ARCGIS}/${webMapId}/data?f=json`,'Michigan CRA ArcGIS web map');return{refs:collectLayerRefs(map),sourceUrl};}

async function rowsFromRefs(refs:LayerRef[],sourceUrl:string){const uniqueRefs=new Map(refs.map(ref=>[ref.url,ref]));if(!uniqueRefs.size)return{rows:[] as Row[],errors:['no FeatureServer layers exposed']};const expanded=(await Promise.allSettled(Array.from(uniqueRefs.values()).map(expandLayers)));const layers=expanded.filter((result):result is PromiseFulfilledResult<LayerRef[]>=>result.status==='fulfilled').flatMap(result=>result.value);const expandErrors=expanded.filter((result):result is PromiseRejectedResult=>result.status==='rejected').map(result=>result.reason instanceof Error?result.reason.message:String(result.reason));const candidateLayers=layers.filter(layer=>RETAIL_RE.test(layer.label));const selected=candidateLayers.length?candidateLayers:layers;const settled=await Promise.allSettled(selected.map(async layer=>({layer,features:await queryLayer(layer)})));const errors=[...expandErrors,...settled.filter((result):result is PromiseRejectedResult=>result.status==='rejected').map(result=>result.reason instanceof Error?result.reason.message:String(result.reason))];const rows:Row[]=[];for(const result of settled){if(result.status!=='fulfilled')continue;for(const feature of result.value.features){const row=featureToRow(feature,result.value.layer.label,sourceUrl);if(row)rows.push(row);}}return{rows,errors};}

function dedupe(rows:Row[]){const unique=new Map<string,Row>();for(const row of rows){const identity=(row.licenseNumber?`license:${row.licenseNumber}`:`place:${row.name}|${row.streetAddress||''}|${row.city||''}`).toLowerCase();if(!unique.has(identity))unique.set(identity,row);}return Array.from(unique.values());}

export async function fetchMichiganCandidates():Promise<Row[]>{
 const failures:string[]=[];
 const publishedIds=await discoverCraPublishedIds();
 for(const id of publishedIds){try{const itemMeta=await getJson(`${ARCGIS}/${id}?f=json`,'Michigan CRA ArcGIS item metadata') as ArcItem;const item:ArcItem={...itemMeta,id};const {refs,sourceUrl}=await layerRefsFromItem(item);const result=await rowsFromRefs(refs,sourceUrl);const rows=dedupe(result.rows);if(rows.length)return rows;failures.push(`${id}: zero recognizable retailer/provisioning-center rows${result.errors.length?` (${result.errors.join(' | ')})`:''}`);}catch(error){failures.push(`${id}: ${error instanceof Error?error.message:String(error)}`);}}

 const discovered=await searchArcgisCandidates();
 for(const item of discovered){if(publishedIds.includes(item.id))continue;try{const {refs,sourceUrl}=await layerRefsFromItem(item);const result=await rowsFromRefs(refs,sourceUrl);const rows=dedupe(result.rows);if(rows.length)return rows;failures.push(`${item.id}: zero recognizable retailer/provisioning-center rows${result.errors.length?` (${result.errors.join(' | ')})`:''}`);}catch(error){failures.push(`${item.id}: ${error instanceof Error?error.message:String(error)}`);}}

 throw new Error(`Michigan CRA source discovery found no usable public retailer dataset. CRA still publishes its Find a Facility and Verify a License resources, but the currently linked ArcGIS item may be unavailable. Refusing an unverified import.${failures.length?` Tried: ${failures.slice(0,8).join(' | ')}`:''}`);
}
