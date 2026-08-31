import 'server-only';
import {getLocationBase,getCommunityProfile,upsertCommunityProfile} from '@/lib/dispensaryCommunity';
import {getDatabase} from '@/lib/sqlite';
import {searchOfficialSiteCandidates} from '@/lib/siteSearchProvider';

export type SiteCandidate={url:string;title:string;snippet:string;score:number;confidence:'high'|'medium'|'low';reasons:string[];warnings:string[]};
const BLOCKED=['weedmaps.com','leafly.com','yelp.com','facebook.com','instagram.com','x.com','twitter.com','google.com','mapquest.com','yellowpages.com','dutchie.com','tripadvisor.com','foursquare.com','linkedin.com','bbb.org','chamberofcommerce.com','manta.com','mapcarta.com','waze.com'];
const DIRECTORY_HINTS=['directory','find a dispensary','dispensaries near','best dispensaries','reviews','menu marketplace','business listing','yellow pages'];
const CHAIN_LOCATION_HINTS=['locations','stores','dispensaries','shop','location'];
function norm(v:unknown){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function tokens(v:unknown){return new Set(norm(v).split(/\s+/).filter(x=>x.length>2));}
function overlap(a:Set<string>,b:Set<string>){if(!a.size)return 0;let n=0;a.forEach(x=>{if(b.has(x))n++;});return n/a.size;}
function hostname(raw:string){try{return new URL(raw).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
function pathname(raw:string){try{return new URL(raw).pathname.toLowerCase();}catch{return '';}}
function blocked(raw:string){const h=hostname(raw);return BLOCKED.some(d=>h===d||h.endsWith('.'+d));}
function includesNorm(hay:string,value:unknown){const needle=norm(value);return Boolean(needle&&norm(hay).includes(needle));}
function scoreCandidate(location:any,item:any):SiteCandidate|null{
 const url=String(item?.link||'');if(!url||blocked(url))return null;
 const title=String(item?.title||''),snippet=String(item?.snippet||''),host=hostname(url),path=pathname(url),plain=`${title} ${snippet} ${host.replace(/\./g,' ')} ${path.replace(/\//g,' ')}`,hay=tokens(plain),name=tokens(location.name),city=tokens(location.city),address=tokens(location.streetAddress),region=tokens(location.region);
 let score=0;const reasons:string[]=[],warnings:string[]=[];
 const nameHit=overlap(name,hay);if(nameHit>=.8){score+=46;reasons.push('very strong business-name match');}else if(nameHit>=.6){score+=38;reasons.push('strong business-name match');}else if(nameHit>=.4){score+=22;reasons.push('partial business-name match');}else{score-=20;warnings.push('weak business-name match');}
 const cityHit=overlap(city,hay);if(cityHit>.5){score+=18;reasons.push('city match');}else if(city.size){score-=8;warnings.push('city not confirmed in result');}
 const regionHit=overlap(region,hay);if(regionHit>.5){score+=8;reasons.push('region match');}
 const addressHit=overlap(address,hay);if(addressHit>=.45){score+=24;reasons.push('strong address match');}else if(addressHit>=.25){score+=12;reasons.push('partial address match');}
 const domainNameHit=overlap(name,tokens(host));if(domainNameHit>=.6){score+=18;reasons.push('business name appears in domain');}else if(domainNameHit>=.35){score+=8;reasons.push('partial business name appears in domain');}
 if(includesNorm(`${title} ${snippet}`,location.city)&&includesNorm(`${title} ${snippet}`,location.name)){score+=8;reasons.push('name and city appear together');}
 const directoryText=norm(`${title} ${snippet}`);if(DIRECTORY_HINTS.some(x=>directoryText.includes(x))){score-=30;warnings.push('result resembles a directory or marketplace');}
 if(/\/search(?:\/|$)|\/category(?:\/|$)|\/dispensaries(?:\/|$)/.test(path)&&!CHAIN_LOCATION_HINTS.some(x=>path.includes(x))){score-=18;warnings.push('generic listing path');}
 const pathHasCity=city.size&&overlap(city,tokens(path))>.5;const pathHasName=overlap(name,tokens(path))>=.4;if(pathHasCity||pathHasName){score+=10;reasons.push('location-specific page path');}
 if(path==='/'&&nameHit>=.6&&cityHit===0&&addressHit===0){score-=8;warnings.push('chain homepage lacks this location signal');}
 if(path!=='/'&&nameHit>=.4&&!pathHasCity&&!pathHasName&&cityHit===0){score-=10;warnings.push('page may belong to another chain location');}
 score=Math.max(0,Math.min(100,score));
 return{url,title,snippet,score,confidence:score>=82?'high':score>=58?'medium':'low',reasons,warnings};
}

export async function discoverOfficialSite(locationId:string,actorId:string,apply=false){
 const location=getLocationBase(locationId);if(!location)throw new Error('Location not found.');
 const current=getCommunityProfile(locationId),existingUrl=String(current?.website||location.website||'').trim();
 if(existingUrl){
  const selected:SiteCandidate={url:existingUrl,title:'Existing GeoWeedo website',snippet:'',score:100,confidence:'high',reasons:['website already stored on GeoWeedo'],warnings:[]};
  return{locationId,query:null,provider:null,cached:false,candidates:[] as SiteCandidate[],selected,runnerUp:null,margin:100,canAutoApply:true,applied:false,existing:true};
 }
 const query=[`\"${location.name}\"`,location.streetAddress,location.city,location.region,'dispensary cannabis'].filter(Boolean).join(' ');
 const search=await searchOfficialSiteCandidates(query);
 const candidates:SiteCandidate[]=search.results.map((x:any)=>scoreCandidate(location,x)).filter((x:SiteCandidate|null):x is SiteCandidate=>x!==null).sort((a,b)=>b.score-a.score),selected=candidates[0]||null,runnerUp=candidates[1]||null;
 const margin=selected&&runnerUp?selected.score-runnerUp.score:selected?selected.score:0;
 if(selected&&runnerUp&&margin<10){selected.warnings.push(`close alternative candidate (${runnerUp.score})`);selected.score=Math.max(0,selected.score-8);selected.confidence=selected.score>=82?'high':selected.score>=58?'medium':'low';}
 const canApply=Boolean(selected&&selected.confidence==='high'&&selected.score>=82&&selected.warnings.length===0);
 const db=getDatabase();
 db.exec(`CREATE TABLE IF NOT EXISTS dispensary_site_discovery_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,location_id TEXT NOT NULL,query TEXT NOT NULL,result_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const result={locationId,query,provider:search.provider,cached:Boolean((search as any).cached),candidates,selected,runnerUp,margin,canAutoApply:canApply,applied:Boolean(apply&&canApply),existing:false};
 db.prepare(`INSERT INTO dispensary_site_discovery_runs(location_id,query,result_json,status,created_at) VALUES(?,?,?,?,?)`).run(locationId,query,JSON.stringify(result),apply&&canApply?'applied':'preview',new Date().toISOString());
 if(apply&&canApply&&selected)upsertCommunityProfile(locationId,{overview:current?.overview,phone:current?.phone,website:selected.url,hours:current?.hours||{},amenities:current?.amenities||[],social:current?.social||{}},{type:'admin',id:actorId});
 return result;
}
