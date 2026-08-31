import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { getCommunityProfile, upsertCommunityProfile } from '@/lib/dispensaryCommunity';
import { DISPENSARY_LICENSE_TYPE_IDS } from '@/lib/licenseTypes';

export const runtime='nodejs';

function clean(v:unknown){const s=String(v??'').trim();return s||null;}
function bool(v:unknown){return v===true||v===1||v==='1';}
function num(v:unknown){const n=Number(v);return Number.isFinite(n)?n:null;}
function profileFor(id:string){return getCommunityProfile(id)||{locationId:id,hours:{},amenities:[],social:{}};}
function ensureLicenseSchema(){getDatabase().exec(`CREATE TABLE IF NOT EXISTS dispensary_license_types(location_id TEXT NOT NULL,license_type TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(location_id,license_type));CREATE INDEX IF NOT EXISTS dispensary_license_types_location_idx ON dispensary_license_types(location_id);`);}
function licenseTypesFor(id:string){ensureLicenseSchema();return (getDatabase().prepare(`SELECT license_type FROM dispensary_license_types WHERE location_id=? ORDER BY license_type`).all(id) as {license_type:string}[]).map(r=>r.license_type);}

export async function GET(request:NextRequest){
 const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});
 ensureLicenseSchema();const db=getDatabase();
 const approved=db.prepare(`SELECT id,'dispensary' kind,name,street_address,city,region,postal_code,country,latitude,longitude,website,phone,license_number,NULL license_status,NULL license_type,data_source,source_url,source_license,recreational,medical,verified,active,NULL status,NULL imagery_status,imagery_provider,priority_weight,sponsored_until,updated_at FROM dispensaries ORDER BY region,city,name`).all() as Record<string,unknown>[];
 const candidates=db.prepare(`SELECT id,'candidate' kind,name,street_address,city,region,postal_code,country,latitude,longitude,website,phone,license_number,license_status,license_type,data_source,source_url,source_license,0 recreational,0 medical,0 verified,1 active,status,imagery_status,NULL imagery_provider,NULL priority_weight,NULL sponsored_until,updated_at FROM dispensary_candidates WHERE status<>'rejected' ORDER BY region,city,name`).all() as Record<string,unknown>[];
 const records=[...approved,...candidates].map(row=>({...row,license_types:licenseTypesFor(String(row.id)),profile:profileFor(String(row.id))}));
 return NextResponse.json({records});
}

export async function PATCH(request:NextRequest){
 const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});
 const body=await request.json().catch(()=>null);if(!body?.id||!body?.kind)return NextResponse.json({error:'id and kind are required.'},{status:400});
 const id=String(body.id),kind=body.kind==='candidate'?'candidate':'dispensary',d=body.details||{},db=getDatabase(),now=new Date().toISOString();
 if(!String(d.name||'').trim())return NextResponse.json({error:'Name is required.'},{status:400});
 const lat=d.latitude===''||d.latitude==null?null:num(d.latitude),lng=d.longitude===''||d.longitude==null?null:num(d.longitude);
 if(lat!==null&&(lat<-90||lat>90)||lng!==null&&(lng<-180||lng>180))return NextResponse.json({error:'Coordinates are outside valid bounds.'},{status:400});
 const licenseTypes:string[]=Array.isArray(d.licenseTypes)?Array.from(new Set<string>(d.licenseTypes.map((v:unknown)=>String(v)).filter((v:string)=>DISPENSARY_LICENSE_TYPE_IDS.has(v)))):[];
 ensureLicenseSchema();
 try{
  db.exec('BEGIN IMMEDIATE');
  if(kind==='dispensary'){
   const result=db.prepare(`UPDATE dispensaries SET name=?,street_address=?,city=?,region=?,postal_code=?,country=?,latitude=?,longitude=?,website=?,phone=?,license_number=?,data_source=?,source_url=?,source_license=?,recreational=?,medical=?,verified=?,active=?,priority_weight=?,sponsored_until=?,updated_at=? WHERE id=?`).run(String(d.name).trim(),clean(d.streetAddress),String(d.city||'').trim(),String(d.region||'').trim(),clean(d.postalCode),String(d.country||'').trim(),lat,lng,clean(d.website),clean(d.phone),clean(d.licenseNumber),clean(d.dataSource),clean(d.sourceUrl),clean(d.sourceLicense),bool(d.recreational)?1:0,bool(d.medical)?1:0,bool(d.verified)?1:0,bool(d.active)?1:0,num(d.priorityWeight),clean(d.sponsoredUntil),now,id);
   if(!Number(result.changes))throw new Error('Dispensary not found.');
  }else{
   const result=db.prepare(`UPDATE dispensary_candidates SET name=?,street_address=?,city=?,region=?,postal_code=?,country=?,latitude=?,longitude=?,website=?,phone=?,license_number=?,license_status=?,license_type=?,data_source=?,source_url=?,source_license=?,status=?,imagery_status=?,updated_at=? WHERE id=?`).run(String(d.name).trim(),clean(d.streetAddress),String(d.city||'').trim(),String(d.region||'').trim(),clean(d.postalCode),String(d.country||'').trim(),lat,lng,clean(d.website),clean(d.phone),clean(d.licenseNumber),clean(d.licenseStatus),clean(d.licenseType),clean(d.dataSource)||'manual',clean(d.sourceUrl),clean(d.sourceLicense),clean(d.status)||'candidate',clean(d.imageryStatus)||'unchecked',now,id);
   if(!Number(result.changes))throw new Error('Candidate not found.');
  }
  db.prepare(`DELETE FROM dispensary_license_types WHERE location_id=?`).run(id);
  const insert=db.prepare(`INSERT INTO dispensary_license_types(location_id,license_type,created_at,updated_at) VALUES(?,?,?,?)`);for(const type of licenseTypes)insert.run(id,type,now,now);
  db.exec('COMMIT');
 }catch(error){try{db.exec('ROLLBACK');}catch{}return NextResponse.json({error:error instanceof Error?error.message:'Update failed.'},{status:400});}
 try{upsertCommunityProfile(id,{overview:String(d.overview||''),phone:String(d.phone||''),website:String(d.website||''),hours:d.hours&&typeof d.hours==='object'?d.hours:{},amenities:Array.isArray(d.amenities)?d.amenities:[],social:d.social&&typeof d.social==='object'?d.social:{}},{type:'admin',id:String(admin.id)});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Profile update failed.'},{status:400});}
 return NextResponse.json({ok:true,id,kind,licenseTypes});
}
