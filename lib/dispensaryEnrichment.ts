import 'server-only';

import { getDatabase } from '@/lib/sqlite';
import { getLocationBase, getCommunityProfile, upsertCommunityProfile } from '@/lib/dispensaryCommunity';

export type EnrichmentResult={locationId:string;website?:string;phone?:string;hours:Record<string,string>;amenities:string[];social:Record<string,string>;logoUrl?:string;sourceUrl:string;confidence:'high'|'medium';notes:string[]};

function cleanUrl(value:unknown){const raw=String(value||'').trim();if(!raw)return undefined;try{const url=new URL(raw.startsWith('http')?raw:`https://${raw}`);if(!['http:','https:'].includes(url.protocol))return undefined;return url.toString();}catch{return undefined;}}
function text(value:unknown){return typeof value==='string'?value.trim():'';}
function walk(node:any,out:any[]){if(!node)return;if(Array.isArray(node)){node.forEach(v=>walk(v,out));return;}if(typeof node==='object'){out.push(node);Object.values(node).forEach(v=>{if(typeof v==='object')walk(v,out);});}}
function parseHours(value:any){const result:Record<string,string>={};const specs=Array.isArray(value)?value:value?[value]:[];for(const spec of specs){const days=Array.isArray(spec?.dayOfWeek)?spec.dayOfWeek:[spec?.dayOfWeek];const opens=text(spec?.opens),closes=text(spec?.closes);for(const dayRaw of days){const day=text(dayRaw).split('/').pop()||'';if(day&&opens)result[day]=closes?`${opens} - ${closes}`:'Open';}}return result;}
function detectAmenities(html:string){const hay=html.toLowerCase();const checks:[string,string[]][]=[['Delivery',['delivery']],['Curbside pickup',['curbside','curbside pickup']],['Online ordering',['online ordering','order online']],['In-store pickup',['pickup','pick-up']],['Wheelchair accessible',['wheelchair accessible','accessible entrance']],['ATM',['atm']],['Parking',['parking']],['Veteran discount',['veteran discount']],['Senior discount',['senior discount']],['Medical cannabis',['medical cannabis','medical marijuana']],['Recreational cannabis',['recreational cannabis','adult-use','adult use']]];return checks.filter(([,terms])=>terms.some(term=>hay.includes(term))).map(([label])=>label);}
function socialFromSameAs(value:any){const result:Record<string,string>={};for(const raw of Array.isArray(value)?value:[value]){const url=cleanUrl(raw);if(!url)continue;if(url.includes('instagram.com'))result.instagram=url;else if(url.includes('facebook.com'))result.facebook=url;else if(url.includes('x.com/')||url.includes('twitter.com/'))result.x=url;}return result;}

export async function enrichFromOfficialWebsite(locationId:string,actorId:string,apply=false):Promise<EnrichmentResult>{
 const location=getLocationBase(locationId);if(!location)throw new Error('Location not found.');
 const website=cleanUrl(location.website||getCommunityProfile(locationId)?.website);if(!website)throw new Error('This location does not have an official website yet. Add/confirm its website first.');
 const response=await fetch(website,{redirect:'follow',cache:'no-store',headers:{'User-Agent':'GeoWeedo/0.4 (+https://geoweedo.com; official business profile enrichment)','Accept':'text/html,application/xhtml+xml'}});
 if(!response.ok)throw new Error(`Official website returned ${response.status}.`);const finalUrl=response.url||website;const html=await response.text();if(html.length>4_000_000)throw new Error('Official website response is too large to safely inspect.');
 const nodes:any[]=[];for(const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(match[1].trim()),nodes);}catch{}}
 const local=nodes.find(n=>{const type=Array.isArray(n?.['@type'])?n['@type'].join(' '):text(n?.['@type']);return /LocalBusiness|Store|Organization|Cannabis/i.test(type);})||nodes.find(n=>n?.telephone||n?.openingHoursSpecification||n?.logo);
 const foundWebsite=cleanUrl(local?.url)||finalUrl,phone=text(local?.telephone)||undefined,hours=parseHours(local?.openingHoursSpecification),social=socialFromSameAs(local?.sameAs);
 let logoUrl=typeof local?.logo==='string'?cleanUrl(local.logo):cleanUrl(local?.logo?.url||local?.image?.url||local?.image);
 if(!logoUrl){const icon=html.match(/<link[^>]+rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1];if(icon)try{logoUrl=new URL(icon,finalUrl).toString();}catch{}}
 const amenities=detectAmenities(html);const notes:string[]=[];if(phone)notes.push('Phone found in official-site structured data.');if(Object.keys(hours).length)notes.push('Hours found in Schema.org openingHoursSpecification.');if(logoUrl)notes.push('Logo/image candidate found on the official website.');if(amenities.length)notes.push('Service/amenity terms found on the official website.');
 const result={locationId,website:foundWebsite,phone,hours,amenities,social,logoUrl,sourceUrl:finalUrl,confidence:local?'high' as const:'medium' as const,notes};
 const db=getDatabase();db.exec(`CREATE TABLE IF NOT EXISTS dispensary_enrichment_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,location_id TEXT NOT NULL,source_url TEXT NOT NULL,result_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);`);db.prepare(`INSERT INTO dispensary_enrichment_runs(location_id,source_url,result_json,status,created_at) VALUES(?,?,?,?,?)`).run(locationId,finalUrl,JSON.stringify(result),apply?'applied':'preview',new Date().toISOString());
 if(apply){const current=getCommunityProfile(locationId);upsertCommunityProfile(locationId,{overview:current?.overview,phone:phone||current?.phone,website:foundWebsite||current?.website,hours:Object.keys(hours).length?hours:(current?.hours||{}),amenities:amenities.length?Array.from(new Set([...(current?.amenities||[]),...amenities])):(current?.amenities||[]),social:{...(current?.social||{}),...social}},{type:'admin',id:actorId});}
 return result;
}
