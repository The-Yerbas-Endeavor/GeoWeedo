import 'server-only';

import {getDatabase} from '@/lib/sqlite';
import {getCommunityProfile,getLocationBase,upsertCommunityProfile} from '@/lib/dispensaryCommunity';

type PlaceLite={id?:string;displayName?:{text?:string};formattedAddress?:string;location?:{latitude?:number;longitude?:number}};
type PlaceDetails=PlaceLite&{nationalPhoneNumber?:string;websiteUri?:string;regularOpeningHours?:{weekdayDescriptions?:string[]};businessStatus?:string;rating?:number;userRatingCount?:number};

const SEARCH_MASK='places.id,places.displayName,places.formattedAddress,places.location';
const DETAILS_MASK='id,displayName,formattedAddress,location,nationalPhoneNumber,websiteUri,regularOpeningHours,businessStatus,rating,userRatingCount';

function apiKey(){return String(process.env.GOOGLE_PLACES_API_KEY||process.env.GOOGLE_MAPS_API_KEY||'').trim();}
export function googlePlacesConfigured(){return Boolean(apiKey());}
function norm(v:unknown){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function tokens(v:unknown){return new Set(norm(v).split(' ').filter(x=>x.length>1));}
function similarity(a:unknown,b:unknown){const aa=tokens(a),bb=tokens(b);if(!aa.size||!bb.size)return 0;let hit=0;aa.forEach(x=>{if(bb.has(x))hit++});return hit/Math.max(aa.size,bb.size);}
function distanceMeters(aLat:number,aLng:number,bLat:number,bLng:number){const r=6371000,p=Math.PI/180,dLat=(bLat-aLat)*p,dLng=(bLng-aLng)*p,x=Math.sin(dLat/2)**2+Math.cos(aLat*p)*Math.cos(bLat*p)*Math.sin(dLng/2)**2;return 2*r*Math.asin(Math.sqrt(x));}
function hoursMap(rows:string[]=[]){const out:Record<string,string>={};for(const row of rows){const i=row.indexOf(':');if(i>0)out[row.slice(0,i).trim()]=row.slice(i+1).trim();}return out;}
function ensureSchema(){getDatabase().exec(`
 CREATE TABLE IF NOT EXISTS google_places_enrichment(
  location_id TEXT PRIMARY KEY,place_id TEXT NOT NULL,confidence TEXT NOT NULL,score INTEGER NOT NULL,
  matched_name TEXT,formatted_address TEXT,latitude REAL,longitude REAL,phone TEXT,website TEXT,
  hours_json TEXT,business_status TEXT,rating REAL,rating_count INTEGER,raw_json TEXT,updated_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS google_places_enrichment_place_idx ON google_places_enrichment(place_id);
 `);}

async function search(base:any){
 const key=apiKey();if(!key)throw new Error('Google Places enrichment is not configured.');
 const textQuery=[base.name,base.streetAddress,base.city,base.region,base.country].filter(Boolean).join(', ');
 const response=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':SEARCH_MASK},body:JSON.stringify({textQuery,pageSize:5}),cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`Google Places search returned ${response.status}.`);
 const json=await response.json();return Array.isArray(json.places)?json.places as PlaceLite[]:[];
}
async function details(placeId:string){const response=await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,{headers:{'X-Goog-Api-Key':apiKey(),'X-Goog-FieldMask':DETAILS_MASK},cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error(`Google Place Details returned ${response.status}.`);return await response.json() as PlaceDetails;}
function scoreMatch(base:any,p:PlaceLite){
 const name=similarity(base.name,p.displayName?.text);const expected=[base.streetAddress,base.city,base.region].filter(Boolean).join(' ');const address=similarity(expected,p.formattedAddress);
 const lat=Number(p.location?.latitude),lng=Number(p.location?.longitude),hasBase=Number.isFinite(Number(base.latitude))&&Number.isFinite(Number(base.longitude)),hasPlace=Number.isFinite(lat)&&Number.isFinite(lng);
 const distance=hasBase&&hasPlace?distanceMeters(Number(base.latitude),Number(base.longitude),lat,lng):null;
 const proximity=distance==null?0.5:distance<=75?1:distance<=250?.9:distance<=750?.7:distance<=2000?.35:0;
 const score=Math.round(name*50+address*25+proximity*25);
 const confidence=score>=85&&name>=.65&&(distance==null||distance<=750)?'high':score>=65?'medium':'low';
 return{score,confidence,nameSimilarity:name,addressSimilarity:address,distanceMeters:distance};
}

export async function previewGooglePlacesEnrichment(locationId:string){
 ensureSchema();const base=getLocationBase(locationId);if(!base)throw new Error('Location not found.');
 const candidates=(await search(base)).map(p=>({place:p,match:scoreMatch(base,p)})).sort((a,b)=>b.match.score-a.match.score);const best=candidates[0];
 if(!best?.place?.id)return{source:'google_places',confidence:'low',score:0,reason:'No Google Places match found.',candidates:[]};
 const runnerUp=candidates[1]?.match.score||0;const confidence=best.match.confidence==='high'&&best.match.score-runnerUp>=8?'high':best.match.confidence==='low'?'low':'medium';
 const place=await details(best.place.id);return{source:'google_places',placeId:best.place.id,confidence,score:best.match.score,runnerUpScore:runnerUp,match:best.match,name:place.displayName?.text||'',formattedAddress:place.formattedAddress||'',latitude:place.location?.latitude,longitude:place.location?.longitude,phone:place.nationalPhoneNumber||'',website:place.websiteUri||'',hours:hoursMap(place.regularOpeningHours?.weekdayDescriptions||[]),businessStatus:place.businessStatus||'',rating:Number.isFinite(Number(place.rating))?Number(place.rating):null,ratingCount:Number.isFinite(Number(place.userRatingCount))?Number(place.userRatingCount):null};
}

export async function applyGooglePlacesEnrichment(locationId:string,actorId:string,preview?:any){
 ensureSchema();const result=preview||await previewGooglePlacesEnrichment(locationId);if(result.confidence!=='high')throw new Error('Google Places match is not high confidence; review is required before applying.');
 const base=getLocationBase(locationId);if(!base)throw new Error('Location not found.');const db=getDatabase(),stamp=new Date().toISOString();
 // Preserve licensing/source authority. Google only enriches consumer-facing business details.
 const table=base.kind==='dispensary'?'dispensaries':'dispensary_candidates';
 const updates:string[]=[],values:any[]=[];
 if(result.name){updates.push('name=?');values.push(result.name)}
 const hasPlaceCoords=Number.isFinite(Number(result.latitude))&&Number.isFinite(Number(result.longitude));
 const coordsChanged=hasPlaceCoords&&(!Number.isFinite(Number(base.latitude))||!Number.isFinite(Number(base.longitude))||Math.abs(Number(base.latitude)-Number(result.latitude))>0.000001||Math.abs(Number(base.longitude)-Number(result.longitude))>0.000001);
 if(hasPlaceCoords){updates.push('latitude=?','longitude=?');values.push(Number(result.latitude),Number(result.longitude))}
 if(result.phone){updates.push('phone=?');values.push(result.phone)}
 if(result.website){updates.push('website=?');values.push(result.website)}
 // Street View checks belong to coordinates, not to the business record forever.
 // If Places corrects a candidate's location, force the gameplay pipeline to
 // validate Street View again at the corrected point.
 if(base.kind==='candidate'&&coordsChanged){updates.push("imagery_status='unchecked'","imagery_count=NULL","imagery_checked_at=NULL",'imagery_message=?');values.push('Coordinates updated by Google Places; Street View recheck required.')}
 if(updates.length){updates.push('updated_at=?');values.push(stamp,locationId);db.prepare(`UPDATE ${table} SET ${updates.join(',')} WHERE id=?`).run(...values);}
 const current=getCommunityProfile(locationId);upsertCommunityProfile(locationId,{overview:current?.overview,phone:result.phone||current?.phone,website:result.website||current?.website,hours:Object.keys(result.hours||{}).length?result.hours:(current?.hours||{}),amenities:current?.amenities||[],social:current?.social||{}},{type:'admin',id:actorId});
 db.prepare(`INSERT INTO google_places_enrichment(location_id,place_id,confidence,score,matched_name,formatted_address,latitude,longitude,phone,website,hours_json,business_status,rating,rating_count,raw_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(location_id) DO UPDATE SET place_id=excluded.place_id,confidence=excluded.confidence,score=excluded.score,matched_name=excluded.matched_name,formatted_address=excluded.formatted_address,latitude=excluded.latitude,longitude=excluded.longitude,phone=excluded.phone,website=excluded.website,hours_json=excluded.hours_json,business_status=excluded.business_status,rating=excluded.rating,rating_count=excluded.rating_count,raw_json=excluded.raw_json,updated_at=excluded.updated_at`).run(locationId,result.placeId,result.confidence,result.score,result.name||null,result.formattedAddress||null,result.latitude??null,result.longitude??null,result.phone||null,result.website||null,JSON.stringify(result.hours||{}),result.businessStatus||null,result.rating??null,result.ratingCount??null,JSON.stringify(result),stamp);
 return result;
}
