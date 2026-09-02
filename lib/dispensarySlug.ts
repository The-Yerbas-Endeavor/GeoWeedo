import 'server-only';
import crypto from 'crypto';
import {getDatabase} from '@/lib/sqlite';
import {getLocationBase} from '@/lib/dispensaryCommunity';

export function slugifyDispensaryName(value:string){
 return String(value||'')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-')
  .replace(/^-+|-+$/g,'').replace(/-{2,}/g,'-').slice(0,110)||'dispensary';
}

function ensureSchema(){
 getDatabase().exec(`
 CREATE TABLE IF NOT EXISTS dispensary_slugs(
  location_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS dispensary_slug_aliases(
  slug TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  created_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS dispensary_slug_alias_location_idx ON dispensary_slug_aliases(location_id);
 `);
}
function available(slug:string,locationId:string){
 const db=getDatabase();
 const row=db.prepare(`SELECT location_id FROM dispensary_slugs WHERE slug=? UNION ALL SELECT location_id FROM dispensary_slug_aliases WHERE slug=? LIMIT 1`).get(slug,slug) as {location_id:string}|undefined;
 return !row||row.location_id===locationId;
}
function collisionSafeSlug(locationId:string,name:string,city?:string,region?:string){
 const base=slugifyDispensaryName(name);
 const attempts=[base,`${base}-${slugifyDispensaryName(city||'')}`,`${base}-${slugifyDispensaryName(city||'')}-${slugifyDispensaryName(region||'')}`]
  .map(v=>v.replace(/-dispensary$/,'').replace(/-{2,}/g,'-').replace(/^-|-$/g,''))
  .filter((v,i,a)=>v&&a.indexOf(v)===i);
 for(const candidate of attempts)if(available(candidate,locationId))return candidate;
 const suffix=crypto.createHash('sha1').update(locationId).digest('hex').slice(0,7);
 return `${base}-${suffix}`;
}
export function getOrCreateDispensarySlug(locationId:string){
 ensureSchema();const db=getDatabase();
 const existing=db.prepare(`SELECT slug FROM dispensary_slugs WHERE location_id=?`).get(locationId) as {slug:string}|undefined;
 if(existing)return existing.slug;
 const location=getLocationBase(locationId);if(!location)return null;
 const slug=collisionSafeSlug(locationId,location.name,location.city,location.region),now=new Date().toISOString();
 db.prepare(`INSERT INTO dispensary_slugs(location_id,slug,created_at,updated_at) VALUES(?,?,?,?)`).run(locationId,slug,now,now);
 return slug;
}
export function updateDispensarySlug(locationId:string,requested:string){
 ensureSchema();const db=getDatabase(),location=getLocationBase(locationId);if(!location)throw new Error('Dispensary not found.');
 const desired=slugifyDispensaryName(requested||location.name);if(!available(desired,locationId))throw new Error('That dispensary URL is already in use.');
 const current=getOrCreateDispensarySlug(locationId);if(current===desired)return desired;const now=new Date().toISOString();
 if(current)db.prepare(`INSERT OR IGNORE INTO dispensary_slug_aliases(slug,location_id,created_at) VALUES(?,?,?)`).run(current,locationId,now);
 db.prepare(`UPDATE dispensary_slugs SET slug=?,updated_at=? WHERE location_id=?`).run(desired,now,locationId);return desired;
}
export function resolveDispensaryIdentifier(value:string){
 ensureSchema();const db=getDatabase();
 const direct=db.prepare(`SELECT location_id FROM dispensary_slugs WHERE slug=?`).get(value) as {location_id:string}|undefined;
 if(direct)return {locationId:direct.location_id,slug:value,alias:false};
 const alias=db.prepare(`SELECT location_id FROM dispensary_slug_aliases WHERE slug=?`).get(value) as {location_id:string}|undefined;
 if(alias){const slug=getOrCreateDispensarySlug(alias.location_id);return {locationId:alias.location_id,slug,alias:true};}
 if(getLocationBase(value)){const slug=getOrCreateDispensarySlug(value);return {locationId:value,slug,alias:true};}
 return null;
}
