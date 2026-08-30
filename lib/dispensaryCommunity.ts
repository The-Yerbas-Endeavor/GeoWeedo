import 'server-only';

import crypto from 'crypto';
import { getDatabase } from '@/lib/sqlite';

export type DispensaryCommunityProfile={
 locationId:string;overview?:string;phone?:string;website?:string;hours?:Record<string,string>;amenities?:string[];social?:Record<string,string>;updatedAt?:string;
};
export type PublicReview={id:string;locationId:string;userId:string;author:string;rating:number;title?:string;body?:string;images:string[];createdAt:string;updatedAt:string};

function ensureSchema(){
 const db=getDatabase();
 db.exec(`
  CREATE TABLE IF NOT EXISTS dispensary_profiles(
   location_id TEXT PRIMARY KEY,
   overview TEXT,
   phone TEXT,
   website TEXT,
   hours_json TEXT,
   amenities_json TEXT,
   social_json TEXT,
   updated_by_type TEXT,
   updated_by_id TEXT,
   updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dispensary_reviews(
   id TEXT PRIMARY KEY,
   location_id TEXT NOT NULL,
   user_id TEXT NOT NULL,
   author_name TEXT NOT NULL,
   rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
   title TEXT,
   body TEXT,
   status TEXT NOT NULL DEFAULT 'pending',
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL,
   UNIQUE(location_id,user_id)
  );
  CREATE TABLE IF NOT EXISTS dispensary_review_images(
   id TEXT PRIMARY KEY,
   review_id TEXT NOT NULL,
   image_path TEXT NOT NULL,
   status TEXT NOT NULL DEFAULT 'pending',
   created_at TEXT NOT NULL,
   FOREIGN KEY(review_id) REFERENCES dispensary_reviews(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS dispensary_owner_assignments(
   id TEXT PRIMARY KEY,
   admin_user_id TEXT NOT NULL,
   location_id TEXT NOT NULL,
   status TEXT NOT NULL DEFAULT 'pending',
   verification_note TEXT,
   verified_by_admin_id TEXT,
   verified_at TEXT,
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL,
   UNIQUE(admin_user_id,location_id)
  );
  CREATE INDEX IF NOT EXISTS dispensary_reviews_location_idx ON dispensary_reviews(location_id,status,created_at DESC);
  CREATE INDEX IF NOT EXISTS dispensary_owner_location_idx ON dispensary_owner_assignments(location_id,status);
 `);
}
function parseJson<T>(value:unknown,fallback:T):T{try{return value?JSON.parse(String(value)) as T:fallback;}catch{return fallback;}}
function optional(value:unknown){return value==null||value===''?undefined:String(value);}

export function getLocationBase(locationId:string){
 ensureSchema();const db=getDatabase();
 const approved=db.prepare(`SELECT id,name,street_address,city,region,postal_code,country,latitude,longitude,website,phone,license_number,data_source,source_url,recreational,medical,verified,active FROM dispensaries WHERE id=?`).get(locationId) as Record<string,unknown>|undefined;
 if(approved)return{kind:'dispensary' as const,id:String(approved.id),name:String(approved.name),streetAddress:optional(approved.street_address),city:String(approved.city||''),region:String(approved.region||''),postalCode:optional(approved.postal_code),country:String(approved.country||''),latitude:Number(approved.latitude),longitude:Number(approved.longitude),website:optional(approved.website),phone:optional(approved.phone),licenseNumber:optional(approved.license_number),dataSource:optional(approved.data_source),sourceUrl:optional(approved.source_url),recreational:Boolean(approved.recreational),medical:Boolean(approved.medical),verified:Boolean(approved.verified),active:Boolean(approved.active)};
 const candidate=db.prepare(`SELECT id,name,street_address,city,region,postal_code,country,latitude,longitude,website,phone,license_number,data_source,source_url,status FROM dispensary_candidates WHERE id=? AND status<>'rejected'`).get(locationId) as Record<string,unknown>|undefined;
 if(candidate)return{kind:'candidate' as const,id:String(candidate.id),name:String(candidate.name),streetAddress:optional(candidate.street_address),city:String(candidate.city||''),region:String(candidate.region||''),postalCode:optional(candidate.postal_code),country:String(candidate.country||''),latitude:Number(candidate.latitude),longitude:Number(candidate.longitude),website:optional(candidate.website),phone:optional(candidate.phone),licenseNumber:optional(candidate.license_number),dataSource:optional(candidate.data_source),sourceUrl:optional(candidate.source_url),verified:false,active:true};
 return null;
}

export function getCommunityProfile(locationId:string):DispensaryCommunityProfile|null{
 ensureSchema();const row=getDatabase().prepare('SELECT * FROM dispensary_profiles WHERE location_id=?').get(locationId) as Record<string,unknown>|undefined;if(!row)return null;
 return{locationId,overview:optional(row.overview),phone:optional(row.phone),website:optional(row.website),hours:parseJson<Record<string,string>>(row.hours_json,{}),amenities:parseJson<string[]>(row.amenities_json,[]),social:parseJson<Record<string,string>>(row.social_json,{}),updatedAt:optional(row.updated_at)};
}
export function reviewSummary(locationId:string){
 ensureSchema();const row=getDatabase().prepare(`SELECT COUNT(*) count,COALESCE(AVG(rating),0) average FROM dispensary_reviews WHERE location_id=? AND status='approved'`).get(locationId) as {count:number;average:number}|undefined;
 return{count:Number(row?.count||0),average:Number(Number(row?.average||0).toFixed(1))};
}
export function listPublicReviews(locationId:string,limit=25):PublicReview[]{
 ensureSchema();const db=getDatabase();const rows=db.prepare(`SELECT * FROM dispensary_reviews WHERE location_id=? AND status='approved' ORDER BY created_at DESC LIMIT ?`).all(locationId,Math.min(100,Math.max(1,limit))) as Record<string,unknown>[];
 return rows.map(row=>{const images=(db.prepare(`SELECT image_path FROM dispensary_review_images WHERE review_id=? AND status='approved' ORDER BY created_at`).all(String(row.id)) as {image_path:string}[]).map(i=>i.image_path);return{id:String(row.id),locationId:String(row.location_id),userId:String(row.user_id),author:String(row.author_name),rating:Number(row.rating),title:optional(row.title),body:optional(row.body),images,createdAt:String(row.created_at),updatedAt:String(row.updated_at)};});
}
export function submitReview(input:{locationId:string;userId:string;author:string;rating:number;title?:string;body?:string}){
 ensureSchema();const db=getDatabase();const now=new Date().toISOString();const rating=Math.round(input.rating);if(rating<1||rating>5)throw new Error('Rating must be between 1 and 5.');if(!getLocationBase(input.locationId))throw new Error('Location not found.');
 const existing=db.prepare('SELECT id FROM dispensary_reviews WHERE location_id=? AND user_id=?').get(input.locationId,input.userId) as {id:string}|undefined;const id=existing?.id||`review-${crypto.randomUUID()}`;
 if(existing)db.prepare(`UPDATE dispensary_reviews SET author_name=?,rating=?,title=?,body=?,status='pending',updated_at=? WHERE id=?`).run(input.author.slice(0,80),rating,input.title?.slice(0,120)||null,input.body?.slice(0,3000)||null,now,id);
 else db.prepare(`INSERT INTO dispensary_reviews(id,location_id,user_id,author_name,rating,title,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)`).run(id,input.locationId,input.userId,input.author.slice(0,80),rating,input.title?.slice(0,120)||null,input.body?.slice(0,3000)||null,now,now);
 return{id,status:'pending' as const};
}
export function upsertCommunityProfile(locationId:string,input:{overview?:string;phone?:string;website?:string;hours?:Record<string,string>;amenities?:string[];social?:Record<string,string>},actor:{type:'admin'|'owner';id:string}){
 ensureSchema();if(!getLocationBase(locationId))throw new Error('Location not found.');const now=new Date().toISOString();getDatabase().prepare(`INSERT INTO dispensary_profiles(location_id,overview,phone,website,hours_json,amenities_json,social_json,updated_by_type,updated_by_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(location_id) DO UPDATE SET overview=excluded.overview,phone=excluded.phone,website=excluded.website,hours_json=excluded.hours_json,amenities_json=excluded.amenities_json,social_json=excluded.social_json,updated_by_type=excluded.updated_by_type,updated_by_id=excluded.updated_by_id,updated_at=excluded.updated_at`).run(locationId,input.overview?.slice(0,5000)||null,input.phone?.slice(0,80)||null,input.website?.slice(0,500)||null,JSON.stringify(input.hours||{}),JSON.stringify((input.amenities||[]).slice(0,50)),JSON.stringify(input.social||{}),actor.type,actor.id,now);return getCommunityProfile(locationId);
}
export function ownerCanEdit(adminUserId:string,locationId:string){ensureSchema();return Boolean(getDatabase().prepare(`SELECT 1 ok FROM dispensary_owner_assignments WHERE admin_user_id=? AND location_id=? AND status='verified'`).get(adminUserId,locationId));}
