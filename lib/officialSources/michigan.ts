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

const SOURCE='https://michigan.maps.arcgis.com/apps/webappviewer/index.html?id=cd5a1a76daaf470b823a382691c0ff60';
const APP_ID='cd5a1a76daaf470b823a382691c0ff60';
const ARCGIS='https://www.arcgis.com/sharing/rest/content/items';
const RETAIL_RE=/mari(?:j|h)uana\s+retailer|adult[- ]use.*retailer|provisioning\s+center/i;

function clean(value:unknown){return String(value??'').replace(/&amp;/g,'&').replace(/&#39;|&apos;|&#x27;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function key(value:string){return value.toLowerCase().replace(/[^a-z0-9]/g,'');}
function normalized(input:Record<string,unknown>){const out:Record<string,unknown>={};for(const [name,value] of Object.entries(input||{}))out[key(name)]=value;return out;}
function pick(row:Record<string,unknown>,names:string[]){for(const name of names){const value=row[key(name)];if(value!==undefined&&value!==null&&clean(value))return clean(value);}return '';}
function number(value:unknown){if(value===undefined||value===null||value==='')return undefined;const n=Number(value);return Number.isFinite(n)?n:undefined;}
function readiness(lat?:number,lng?:number){return lat!==undefined&&lng!==undefined?'unchecked' as const:'missing_coordinates' as const;}
function parseAddress(value:string){const address=clean(value);const match=address.match(/^(.*?)(?:,\s*|\s+)([A-Za-z .'-]{2,60}),?\s+MI\s+(\d{5}(?:-\d{4})?)(?:\s+United States)?$/i);return{streetAddress:address||undefined,city:match?.[2]?.trim()};}

async function getJson(url:string,label:string){let response:Response;try{response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'GeoWeedo/0.4 (https://geoweedo.com)'},cache:'no-store',signal:AbortSignal.timeout(20000)});}catch(error){throw new Error(`${label} request failed: ${error instanceof Error?error.message:String(error)}`);}if(!response.ok)throw new Error(`${label} returned HTTP ${response.status}`);const body=await response.json();if(body?.error)throw new Error(`${label} returned ArcGIS error ${body.error.code||''}: ${body.error.message||'unknown error'}`);return body;}

function findWebMapId(app:any){const candidates=[app?.map?.itemId,app?.map?.webMapId,app?.values?.webmap,app?.values?.webMap,app?.webmap,app?.webMapId];for(const value of candidates){if(typeof value==='string'&&/^[a-f0-9]{32}$/i.test(value))return value;}const text=JSON.stringify(app);const matches=[...text.matchAll(/(?:webmap|webMap|itemId)[^a-f0-9]{0,20}([a-f0-9]{32})/gi)].map(m=>m[1]);return matches[0];}

function collectLayerRefs(value:any,out:LayerRef[]=[],parent=''):LayerRef[]{if(!value)return out;if(Array.isArray(value)){for(const item of value)collectLayerRefs(item,out,parent);return out;}if(typeof value!=='object')return out;const label=clean(value.title||value.name||parent);if(typeof value.url==='string'&&/\/FeatureServer(?:\/\d+)?\/?$/i.test(value.url))out.push({url:value.url.replace(/\/$/,''),label});for(const [name,child] of Object.entries(value))collectLayerRefs(child,out,label||name);return out;}

async function expandLayers(ref:LayerRef):Promise<LayerRef[]>{if(/\/FeatureServer\/\d+$/i.test(ref.url))return[ref];const meta=await getJson(`${ref.url}?f=json`,'Michigan CRA ArcGIS service metadata');const layers=Array.isArray(meta.layers)?meta.layers:[];return layers.map((layer:any)=>({url:`${ref.url}/${layer.id}`,label:clean(layer.name||ref.label)}));}

async function queryLayer(layer:LayerRef){const features:any[]=[];let offset=0;for(let page=0;page<20;page++){const params=new URLSearchParams({where:'1=1',outFields:'*',returnGeometry:'true',outSR:'4326',f:'json',resultOffset:String(offset),resultRecordCount:'2000'});const body=await getJson(`${layer.url}/query?${params.toString()}`,`Michigan CRA ArcGIS layer ${layer.label||layer.url}`);const batch=Array.isArray(body.features)?body.features:[];features.push(...batch);if(!body.exceededTransferLimit||batch.length===0)break;offset+=batch.length;}return features;}

function featureToRow(feature:any,layerLabel:string):Row|null{const attrs=normalized(feature?.attributes||{});const type=pick(attrs,['License Type','Record Type','Type','Facility Type','LicenseType','Category'])||layerLabel;const licenseNumber=pick(attrs,['License Number','License #','Record Number','Record #','LicenseNumber','License_ID','License ID']);const haystack=`${layerLabel} ${type} ${licenseNumber}`;
 if(!RETAIL_RE.test(haystack)&&!/^AU-R-/i.test(licenseNumber))return null;
 const status=pick(attrs,['Status','Record Status','License Status','LicenseStatus']);if(status&&!/active|approved|current/i.test(status))return null;
 const name=pick(attrs,['DBA','DBA Name','Doing Business As','License Name','Licensee Name','Business Name','Facility Name','Establishment Name','Name']);if(!name)return null;
 const rawAddress=pick(attrs,['Address','Street Address','Facility Address','Physical Address','Location Address','Premise Address']);const parsed=parseAddress(rawAddress);const city=pick(attrs,['City','Facility City','Physical City','Premise City'])||parsed.city;
 const geometry=feature?.geometry||{};const latitude=number(geometry.y??attrs.latitude??attrs.lat),longitude=number(geometry.x??attrs.longitude??attrs.lng??attrs.lon);
 if(latitude!==undefined&&(latitude<41.5||latitude>49.0))return null;if(longitude!==undefined&&(longitude<-91.0||longitude>-82.0))return null;
 const website=pick(attrs,['Website','Web Site','URL','Business Website'])||undefined;
 return{name,streetAddress:parsed.streetAddress,city:city||undefined,region:'Michigan',country:'USA',latitude,longitude,website,licenseNumber:licenseNumber||undefined,dataSource:'Michigan CRA Active Cannabis Business Map',sourceUrl:SOURCE,sourceLicense:'Official Michigan Cannabis Regulatory Agency public Find a Facility ArcGIS map; adult-use Marijuana Retailer and medical Provisioning Center locations only.',imageryStatus:readiness(latitude,longitude)};
}

export async function fetchMichiganCandidates():Promise<Row[]>{
 const app=await getJson(`https://michigan.maps.arcgis.com/sharing/rest/content/items/${APP_ID}/data?f=json`,'Michigan CRA ArcGIS application');const webMapId=findWebMapId(app);if(!webMapId)throw new Error('Michigan CRA ArcGIS application did not expose its public web-map item id.');
 const map=await getJson(`${ARCGIS}/${webMapId}/data?f=json`,'Michigan CRA ArcGIS web map');const rawRefs=collectLayerRefs(map);const uniqueRefs=new Map(rawRefs.map(ref=>[ref.url,ref]));if(!uniqueRefs.size)throw new Error('Michigan CRA ArcGIS web map did not expose any FeatureServer layers.');
 const expanded=(await Promise.all(Array.from(uniqueRefs.values()).map(expandLayers))).flat();const candidateLayers=expanded.filter(layer=>RETAIL_RE.test(layer.label));const layers=candidateLayers.length?candidateLayers:expanded;
 const settled=await Promise.allSettled(layers.map(async layer=>({layer,features:await queryLayer(layer)})));const errors=settled.filter((result):result is PromiseRejectedResult=>result.status==='rejected').map(result=>result.reason instanceof Error?result.reason.message:String(result.reason));const rows:Row[]=[];
 for(const result of settled){if(result.status!=='fulfilled')continue;for(const feature of result.value.features){const row=featureToRow(feature,result.value.layer.label);if(row)rows.push(row);}}
 const unique=new Map<string,Row>();for(const row of rows){const identity=(row.licenseNumber?`license:${row.licenseNumber}`:`place:${row.name}|${row.streetAddress||''}|${row.city||''}`).toLowerCase();if(!unique.has(identity))unique.set(identity,row);}if(!unique.size)throw new Error(`Michigan CRA ArcGIS map returned zero recognizable Marijuana Retailer or Provisioning Center locations${errors.length?`; layer errors: ${errors.join(' | ')}`:''}. Refusing an unverified import.`);return Array.from(unique.values());
}
