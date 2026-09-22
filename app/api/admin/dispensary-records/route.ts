import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { getCommunityProfile, upsertCommunityProfile } from '@/lib/dispensaryCommunity';
import { DISPENSARY_LICENSE_TYPE_IDS } from '@/lib/licenseTypes';
import {getProfileVerification,markProfileVerified,markProfileReauditDue} from '@/lib/dispensaryProfileVerification';
import { strongLocationIdentityKeys } from '@/lib/locationIdentity';
import { reverseGeocodeCoordinates } from '@/lib/reverseGeocode';

export const runtime='nodejs';
function clean(v:unknown){const s=String(v??'').trim();return s||null;} function bool(v:unknown){return v===true||v===1||v==='1';} function num(v:unknown){const n=Number(v);return Number.isFinite(n)?n:null;}
function profileFor(id:string){return getCommunityProfile(id)||{locationId:id,hours:{},amenities:[],social:{}};}
function tableExists(db:any,name:string){return Boolean(db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(name));}
function placeholderDispensaryName(value:unknown){return String(value??'').trim().replace(/\s+/g,' ').toLowerCase()==='data not available';}
function tableCount(db:any,table:string,column:string,id:string){if(!tableExists(db,table))return 0;return Number((db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${column}=?`).get(id) as any)?.count||0);}
function deletePlaceholderDispensaries(ids:string[],adminId:string){
 const db=getDatabase(),unique=Array.from(new Set(ids.map(String).filter(Boolean))).slice(0,5000);
 const deleted:string[]=[],skipped:Array<{id:string;reason:string}>=[];
 const blockers:Array<[string,string,string]>=[
  ['game_rounds','dispensary_id','game history'],
  ['daily_challenge_rounds','dispensary_id','daily challenge history'],
  ['dispensary_menus','dispensary_id','menu data'],
  ['dispensary_reviews','location_id','community reviews'],
  ['dispensary_owner_assignments','location_id','owner assignment'],
  ['dispensary_owner_claims','location_id','owner claim'],
  ['dispensary_user_owner_assignments','location_id','verified owner assignment'],
  ['sponsorships','dispensary_id','sponsorship history'],
  ['sponsor_business_locations','dispensary_id','sponsor business link'],
  ['sponsor_entitlements','dispensary_id','featured entitlement'],
  ['sponsor_events','dispensary_id','sponsor analytics'],
  ['sponsor_requests','dispensary_id','sponsor request'],
 ];
 const cleanup:Array<[string,string]>= [
  ['dispensary_profiles','location_id'],
  ['dispensary_profile_verifications','location_id'],
  ['dispensary_license_types','location_id'],
  ['google_places_enrichment','location_id'],
  ['dispensary_batch_items','location_id'],
 ];
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const id of unique){
   const row=db.prepare('SELECT id,name FROM dispensaries WHERE id=? LIMIT 1').get(id) as {id:string;name:string}|undefined;
   if(!row){skipped.push({id,reason:'not found'});continue;}
   if(!placeholderDispensaryName(row.name)){skipped.push({id,reason:'name is no longer Data Not Available'});continue;}
   const protectedBy=blockers.find(([table,column])=>tableCount(db,table,column,id)>0);
   if(protectedBy){skipped.push({id,reason:`protected by ${protectedBy[2]}`});continue;}
   db.exec('SAVEPOINT delete_placeholder');
   try{
    for(const [table,column] of cleanup){
     if(tableExists(db,table))db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(id);
    }
    const result=db.prepare("DELETE FROM dispensaries WHERE id=? AND lower(trim(name))='data not available'").run(id);
    if(!Number(result.changes))throw new Error('placeholder changed before deletion');
    if(tableExists(db,'audit_log')){
     db.prepare(`INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,metadata_json,created_at)
       VALUES (?,'admin',?,'dispensary.placeholder_deleted','dispensary',?,?,?)`)
       .run(`audit-${randomUUID()}`,adminId,id,JSON.stringify({name:row.name}),new Date().toISOString());
    }
    db.exec('RELEASE SAVEPOINT delete_placeholder');
    deleted.push(id);
   }catch(error){
    try{db.exec('ROLLBACK TO SAVEPOINT delete_placeholder');db.exec('RELEASE SAVEPOINT delete_placeholder');}catch{}
    skipped.push({id,reason:error instanceof Error?error.message:'delete failed'});
   }
  }
  db.exec('COMMIT');
 }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
 return {requested:unique.length,deleted,skipped};
}
function ensureLicenseSchema(){getDatabase().exec(`CREATE TABLE IF NOT EXISTS dispensary_license_types(location_id TEXT NOT NULL,license_type TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(location_id,license_type));CREATE INDEX IF NOT EXISTS dispensary_license_types_location_idx ON dispensary_license_types(location_id);`);}
function licenseTypesFor(id:string){ensureLicenseSchema();return (getDatabase().prepare(`SELECT license_type FROM dispensary_license_types WHERE location_id=? ORDER BY license_type`).all(id) as {license_type:string}[]).map(r=>r.license_type);}
function automatedEnrichmentIds(){try{const db=getDatabase();const table=db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dispensary_batch_items'`).get();if(!table)return new Set<string>();const rows=db.prepare(`SELECT DISTINCT location_id FROM dispensary_batch_items WHERE record_type='candidate' AND status='applied'`).all() as {location_id:string}[];return new Set(rows.map(row=>String(row.location_id)));}catch{return new Set<string>();}}
function decorate(row:Record<string,unknown>,enriched:Set<string>){const id=String(row.id);return {...row,license_types:licenseTypesFor(id),profile:profileFor(id),profile_verification:getProfileVerification(id),automated_enrichment_approved:enriched.has(id)};}
const AUDIT_DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function auditText(v:unknown){return String(v??'').trim();}
function auditHoursCount(profile:any){return AUDIT_DAYS.filter(day=>auditText(profile?.hours?.[day])).length;}
function auditHasAddress(row:any){return Boolean(auditText(row.street_address)&&auditText(row.city)&&auditText(row.region)&&auditText(row.country));}
function auditHasCoords(row:any){return row.latitude!=null&&row.longitude!=null&&auditText(row.latitude)!==''&&auditText(row.longitude)!==''&&Number.isFinite(Number(row.latitude))&&Number.isFinite(Number(row.longitude));}
function auditCompleteness(row:any){
 const profile=row.profile||{},checks=[
  Boolean(auditText(profile.website||row.website)),
  Boolean(auditText(profile.phone||row.phone)),
  auditHoursCount(profile)>=7,
  auditHasAddress(row),
  auditHasCoords(row),
  Boolean(auditText(row.license_number)),
  Boolean(auditText(profile.overview)),
  Array.isArray(profile.amenities)&&profile.amenities.length>0,
  Object.values(profile.social||{}).some(value=>Boolean(auditText(value))),
  Boolean(auditText(row.data_source)&&auditText(row.source_url)),
  Boolean(auditText(row.imagery_provider)),
 ];
 return Math.round(checks.filter(Boolean).length/checks.length*100);
}
function auditProjectedConfidence(row:any,complete:number){
 const source=auditText(row.data_source)&&auditText(row.source_url)?5:0;
 return Math.min(100,Math.round(complete*.7+15+10+source));
}
export async function GET(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});ensureLicenseSchema();const db=getDatabase(),enriched=automatedEnrichmentIds(),requestedId=String(request.nextUrl.searchParams.get('id')||'').trim();if(requestedId){const row=db.prepare(`SELECT id,'dispensary' kind,name,street_address,city,region,postal_code,country,latitude,longitude,website,phone,license_number,NULL license_status,NULL license_type,data_source,source_url,source_license,recreational,medical,verified,gameplay_enabled,active,NULL status,NULL imagery_status,NULL imagery_count,NULL imagery_message,imagery_provider,priority_weight,sponsored_until,updated_at FROM dispensaries WHERE id=?`).get(requestedId) as Record<string,unknown>|undefined;if(!row)return NextResponse.json({error:'Dispensary not found.'},{status:404});return NextResponse.json({record:decorate(row,enriched)});}const approved=db.prepare(`SELECT id,'dispensary' kind,name,street_address,city,region,postal_code,country,latitude,longitude,website,phone,license_number,NULL license_status,NULL license_type,data_source,source_url,source_license,recreational,medical,verified,gameplay_enabled,active,NULL status,NULL imagery_status,NULL imagery_count,NULL imagery_message,imagery_provider,priority_weight,sponsored_until,updated_at FROM dispensaries ORDER BY region,city,name`).all() as Record<string,unknown>[];
const candidates=db.prepare(`SELECT id,'candidate' kind,name,street_address,city,region,postal_code,country,latitude,longitude,website,phone,license_number,license_status,license_type,data_source,source_url,source_license,0 recreational,0 medical,0 verified,0 gameplay_enabled,1 active,status,imagery_status,imagery_count,imagery_message,NULL imagery_provider,NULL priority_weight,NULL sponsored_until,updated_at FROM dispensary_candidates WHERE status<>'approved' ORDER BY region,city,name`).all() as Record<string,unknown>[];
const identity=(row:Record<string,unknown>)=>({name:clean(row.name),streetAddress:clean(row.street_address),city:clean(row.city),region:clean(row.region),country:clean(row.country),latitude:row.latitude==null?null:num(row.latitude),longitude:row.longitude==null?null:num(row.longitude),licenseNumber:clean(row.license_number)});
const approvedKeys=new Set(approved.flatMap(row=>strongLocationIdentityKeys(identity(row))));
const seenCandidateKeys=new Set<string>();
const visibleCandidates=candidates.filter(row=>{if(String(row.status)==='rejected')return true;const keys=strongLocationIdentityKeys(identity(row));if(keys.some(key=>approvedKeys.has(key)||seenCandidateKeys.has(key)))return false;for(const key of keys)seenCandidateKeys.add(key);return true;});
return NextResponse.json({records:[...approved,...visibleCandidates].map(row=>decorate(row,enriched)),suppressedDuplicateCandidates:candidates.length-visibleCandidates.length});}
export async function POST(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});const body=await request.json().catch(()=>null);const action=String(body?.action||'');if(action==='lookup-coordinate-locality'){const latitude=num(body?.latitude),longitude=num(body?.longitude);if(latitude==null||longitude==null||latitude<-90||latitude>90||longitude<-180||longitude>180)return NextResponse.json({error:'Valid coordinates are required.'},{status:400});try{const location=await reverseGeocodeCoordinates(latitude,longitude);if(!location)return NextResponse.json({error:'No city or postal code could be resolved for those coordinates.'},{status:404});return NextResponse.json({ok:true,location});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Reverse geocoding failed.'},{status:502});}}if(action!=='bulk-profile-audit'&&!body?.id)return NextResponse.json({error:'id is required.'},{status:400});if(action==='mark-profile-verified'){const days=Math.min(365,Math.max(7,Number(body.reauditDays)||90));return NextResponse.json({ok:true,verification:markProfileVerified(String(body.id),`admin:${String(admin.id)}`,String(body.source||'manual'),String(body.notes||''),days)});}
if(action==='delete-placeholder-dispensaries'){
 const ids=Array.isArray(body?.ids)?body.ids.map((value:unknown)=>String(value)).filter(Boolean):(body?.id?[String(body.id)]:[]);
 if(!ids.length)return NextResponse.json({error:'At least one dispensary id is required.'},{status:400});
 try{
  const result=deletePlaceholderDispensaries(ids,String(admin.id));
  return NextResponse.json({ok:true,...result});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:'Placeholder deletion failed.'},{status:400});
 }
}
if(action==='bulk-profile-audit'){
 const days=Math.min(365,Math.max(7,Number(body.reauditDays)||90)),completeThreshold=64,confidenceThreshold=75,db=getDatabase(),enriched=automatedEnrichmentIds();
 const rows=db.prepare(`SELECT id,'dispensary' kind,name,street_address,city,region,postal_code,country,latitude,longitude,website,phone,license_number,data_source,source_url,source_license,recreational,medical,verified,gameplay_enabled,active,imagery_provider,priority_weight,sponsored_until,updated_at
 FROM dispensaries WHERE active<>0 AND gameplay_enabled<>0 ORDER BY region,city,name`).all() as Record<string,unknown>[];
 let approved=0,reaudit=0;
 const failures:{id:string;name:string;complete:number;confidence:number}[]=[];
 for(const raw of rows){
  const row:any=decorate(raw,enriched),complete=auditCompleteness(row),confidence=auditProjectedConfidence(row,complete),id=String(row.id),name=String(row.name||'Dispensary');
  if(complete>=completeThreshold&&confidence>=confidenceThreshold){
   markProfileVerified(id,`admin:${String(admin.id)}`,'bulk-audit',`Auto-approved by bulk audit: completeness ${complete}%, projected confidence ${confidence}%.`,days);
   approved++;
  }else{
   markProfileReauditDue(id,`admin:${String(admin.id)}`,'bulk-audit',`Bulk audit requires re-audit: completeness ${complete}%, projected confidence ${confidence}%.`);
   reaudit++;
   if(failures.length<50)failures.push({id,name,complete,confidence});
  }
 }
 return NextResponse.json({ok:true,total:rows.length,approved,reaudit,completeThreshold,confidenceThreshold,reauditDays:days,failures});
}
if(action==='set-gameplay-bulk'){
 const ids=Array.from(new Set<string>((Array.isArray(body?.ids)?body.ids:[]).map((value:unknown)=>String(value)).filter(Boolean))).slice(0,5000);
 if(!ids.length)return NextResponse.json({error:'At least one dispensary id is required.'},{status:400});
 const db=getDatabase(),now=new Date().toISOString(),placeholders=ids.map(()=>'?').join(',');
 const rows=db.prepare(`SELECT id,name,latitude,longitude,imagery_provider,gameplay_enabled FROM dispensaries WHERE id IN (${placeholders})`).all(...ids) as Array<{id:string;name:string;latitude:number|null;longitude:number|null;imagery_provider:string|null;gameplay_enabled:number}>;
 let updated=0,skipped=0;
 const skippedReasons:Record<string,number>={};
 const update=db.prepare('UPDATE dispensaries SET gameplay_enabled=1,verified=1,updated_at=? WHERE id=?');
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const row of rows){
   if(row.gameplay_enabled!==0){skipped++;skippedReasons.already_enabled=(skippedReasons.already_enabled||0)+1;continue;}
   if(!Number.isFinite(Number(row.latitude))||!Number.isFinite(Number(row.longitude))){skipped++;skippedReasons.missing_coordinates=(skippedReasons.missing_coordinates||0)+1;continue;}
   if(!String(row.imagery_provider||'').trim()){skipped++;skippedReasons.missing_imagery=(skippedReasons.missing_imagery||0)+1;continue;}
   update.run(now,row.id);updated++;
  }
  db.exec('COMMIT');
 }catch(error){
  try{db.exec('ROLLBACK');}catch{}
  return NextResponse.json({error:error instanceof Error?error.message:'Bulk gameplay update failed.'},{status:400});
 }
 const unmatched=Math.max(0,ids.length-rows.length);
 if(unmatched){skipped+=unmatched;skippedReasons.not_found=(skippedReasons.not_found||0)+unmatched;}
 return NextResponse.json({ok:true,requested:ids.length,matched:rows.length,updated,skipped,skippedReasons});
}
if(action==='set-browse'){const id=String(body.id),db=getDatabase(),active=bool(body.active),now=new Date().toISOString();const result=db.prepare('UPDATE dispensaries SET active=?,updated_at=? WHERE id=?').run(active?1:0,now,id);if(!Number(result.changes))return NextResponse.json({error:'Dispensary not found.'},{status:404});return NextResponse.json({ok:true,id,active});}if(action==='set-gameplay'){const id=String(body.id),db=getDatabase(),enabled=bool(body.enabled),now=new Date().toISOString();const row=db.prepare('SELECT id,name,latitude,longitude,imagery_provider FROM dispensaries WHERE id=?').get(id) as {id:string;name:string;latitude:number|null;longitude:number|null;imagery_provider:string|null}|undefined;if(!row)return NextResponse.json({error:'Dispensary not found.'},{status:404});if(enabled&&(!Number.isFinite(Number(row.latitude))||!Number.isFinite(Number(row.longitude))||!String(row.imagery_provider||'').trim()))return NextResponse.json({error:'Gameplay requires valid coordinates and approved Street View imagery.'},{status:400});db.prepare('UPDATE dispensaries SET gameplay_enabled=?,verified=1,updated_at=? WHERE id=?').run(enabled?1:0,now,id);return NextResponse.json({ok:true,id,enabled});}if(action==='reject-dispensary'){const id=String(body.id),db=getDatabase(),now=new Date().toISOString();const row=db.prepare('SELECT id,name FROM dispensaries WHERE id=?').get(id) as {id:string;name:string}|undefined;if(!row)return NextResponse.json({error:'Dispensary not found.'},{status:404});const result=db.prepare('UPDATE dispensaries SET verified=0,gameplay_enabled=0,active=0,updated_at=? WHERE id=?').run(now,id);if(!Number(result.changes))return NextResponse.json({error:'Dispensary could not be disabled.'},{status:400});return NextResponse.json({ok:true,id,name:row.name,rejected:true,gameplayDisabled:true,browseDisabled:true});}return NextResponse.json({error:'Unsupported action.'},{status:400});}
export async function PATCH(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});const body=await request.json().catch(()=>null);if(!body?.id||!body?.kind)return NextResponse.json({error:'id and kind are required.'},{status:400});const id=String(body.id),kind=body.kind==='candidate'?'candidate':'dispensary',d=body.details||{},db=getDatabase(),now=new Date().toISOString();if(!String(d.name||'').trim())return NextResponse.json({error:'Name is required.'},{status:400});const lat=d.latitude===''||d.latitude==null?null:num(d.latitude),lng=d.longitude===''||d.longitude==null?null:num(d.longitude);if(lat!==null&&(lat<-90||lat>90)||lng!==null&&(lng<-180||lng>180))return NextResponse.json({error:'Coordinates are outside valid bounds.'},{status:400});let city=String(d.city||'').trim(),region=String(d.region||'').trim(),postalCode=clean(d.postalCode),country=String(d.country||'').trim();if(lat!==null&&lng!==null&&(!city||!postalCode)){try{const location=await reverseGeocodeCoordinates(lat,lng);if(location){city=city||location.city||'';postalCode=postalCode||clean(location.postalCode);region=region||location.region||'';country=country||location.country||'';}}catch{}}const licenseTypes:string[]=Array.isArray(d.licenseTypes)?Array.from(new Set<string>(d.licenseTypes.map((v:unknown)=>String(v)).filter((v:string)=>DISPENSARY_LICENSE_TYPE_IDS.has(v)))):[];ensureLicenseSchema();try{db.exec('BEGIN IMMEDIATE');if(kind==='dispensary'){const result=db.prepare(`UPDATE dispensaries SET name=?,street_address=?,city=?,region=?,postal_code=?,country=?,latitude=?,longitude=?,website=?,phone=?,license_number=?,data_source=?,source_url=?,source_license=?,recreational=?,medical=?,verified=?,gameplay_enabled=?,active=?,priority_weight=?,sponsored_until=?,updated_at=? WHERE id=?`).run(String(d.name).trim(),clean(d.streetAddress),city,region,postalCode,country,lat,lng,clean(d.website),clean(d.phone),clean(d.licenseNumber),clean(d.dataSource),clean(d.sourceUrl),clean(d.sourceLicense),bool(d.recreational)?1:0,bool(d.medical)?1:0,1,bool(d.gameplayEnabled)?1:0,bool(d.active)?1:0,num(d.priorityWeight),clean(d.sponsoredUntil),now,id);if(!Number(result.changes))throw new Error('Dispensary not found.');}else{const result=db.prepare(`UPDATE dispensary_candidates SET name=?,street_address=?,city=?,region=?,postal_code=?,country=?,latitude=?,longitude=?,website=?,phone=?,license_number=?,license_status=?,license_type=?,data_source=?,source_url=?,source_license=?,status=?,imagery_status=?,updated_at=? WHERE id=?`).run(String(d.name).trim(),clean(d.streetAddress),city,region,postalCode,country,lat,lng,clean(d.website),clean(d.phone),clean(d.licenseNumber),clean(d.licenseStatus),clean(d.licenseType),clean(d.dataSource)||'manual',clean(d.sourceUrl),clean(d.sourceLicense),(['candidate','reviewing','rejected'].includes(String(d.status))?String(d.status):'candidate'),clean(d.imageryStatus)||'unchecked',now,id);if(!Number(result.changes))throw new Error('Candidate not found.');}db.prepare(`DELETE FROM dispensary_license_types WHERE location_id=?`).run(id);const insert=db.prepare(`INSERT INTO dispensary_license_types(location_id,license_type,created_at,updated_at) VALUES(?,?,?,?)`);for(const type of licenseTypes)insert.run(id,type,now,now);db.exec('COMMIT');}catch(error){try{db.exec('ROLLBACK');}catch{}return NextResponse.json({error:error instanceof Error?error.message:'Update failed.'},{status:400});}try{upsertCommunityProfile(id,{overview:String(d.overview||''),phone:String(d.phone||''),website:String(d.website||''),hours:d.hours&&typeof d.hours==='object'?d.hours:{},amenities:Array.isArray(d.amenities)?d.amenities:[],social:d.social&&typeof d.social==='object'?d.social:{}},{type:'admin',id:String(admin.id)});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Profile update failed.'},{status:400});}return NextResponse.json({ok:true,id,kind,licenseTypes});}