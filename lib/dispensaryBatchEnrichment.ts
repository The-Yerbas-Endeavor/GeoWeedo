import 'server-only';

import crypto from 'crypto';
import {getDatabase} from '@/lib/sqlite';
import {getLocationBase,getCommunityProfile,upsertCommunityProfile} from '@/lib/dispensaryCommunity';
import {discoverOfficialSite} from '@/lib/officialSiteDiscovery';
import {enrichFromOfficialWebsite} from '@/lib/dispensaryEnrichment';
import {configuredSiteSearchProvider,siteSearchProviderLabel} from '@/lib/siteSearchProvider';

type Scope={country?:string;region?:string;recordType?:'all'|'dispensary'|'candidate';missing?:'any'|'website'|'phone'|'hours'|'amenities'};
const DISCOVERY_BLOCKED_MESSAGE='Official-site discovery is not configured. Configure BRAVE_SEARCH_API_KEY or existing Google Custom Search credentials before processing records that do not already have a website.';

export function discoveryConfigured(){return Boolean(configuredSiteSearchProvider());}
export function discoveryProvider(){const provider=configuredSiteSearchProvider();return{provider,label:siteSearchProviderLabel(provider)};}

function ensureSchema(){
 const db=getDatabase();
 db.exec(`
  CREATE TABLE IF NOT EXISTS dispensary_batch_jobs(id TEXT PRIMARY KEY,created_by TEXT NOT NULL,scope_json TEXT NOT NULL,auto_apply INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'queued',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dispensary_batch_items(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,location_id TEXT NOT NULL,location_name TEXT NOT NULL,record_type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',stage TEXT NOT NULL DEFAULT 'discovery',message TEXT,result_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(job_id,location_id));
  CREATE TABLE IF NOT EXISTS dispensary_enrichment_review_queue(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,item_id TEXT NOT NULL,location_id TEXT NOT NULL,location_name TEXT NOT NULL,review_type TEXT NOT NULL,confidence TEXT NOT NULL,score INTEGER,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reviewed_by TEXT,reviewed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS dispensary_batch_items_job_idx ON dispensary_batch_items(job_id,status,created_at);
  CREATE INDEX IF NOT EXISTS dispensary_review_queue_status_idx ON dispensary_enrichment_review_queue(status,created_at);
 `);
 db.prepare(`UPDATE dispensary_batch_items SET status='blocked',stage='discovery',message=? WHERE status='failed' AND message LIKE 'Official-site discovery is not configured.%'`).run(DISCOVERY_BLOCKED_MESSAGE);
}
function now(){return new Date().toISOString();}
function profileState(locationId:string,base:any){const p=getCommunityProfile(locationId);return{website:String(p?.website||base?.website||'').trim(),phone:String(p?.phone||base?.phone||'').trim(),hours:p?.hours||{},amenities:p?.amenities||[]};}
function profileMissing(locationId:string,missing:Scope['missing'],base:any){const s=profileState(locationId,base);if(missing==='website')return !s.website;if(missing==='phone')return !s.phone;if(missing==='hours')return Object.keys(s.hours).length===0;if(missing==='amenities')return s.amenities.length===0;return !s.website||!s.phone||Object.keys(s.hours).length===0||s.amenities.length===0;}
export function getBatchScopeOptions(){ensureSchema();const db=getDatabase();const rows=[...(db.prepare(`SELECT country,region FROM dispensaries WHERE active=1`).all() as any[]),...(db.prepare(`SELECT country,region FROM dispensary_candidates WHERE status<>'rejected'`).all() as any[])];const countries=Array.from(new Set(rows.map(r=>String(r.country||'').trim()).filter(Boolean))).sort();const regions=Array.from(new Set(rows.map(r=>String(r.region||'').trim()).filter(Boolean))).sort();return{countries,regions};}

export function createBatchJob(actorId:string,scope:Scope,autoApply=true){
 ensureSchema();
 const db=getDatabase(),id=`batch-${crypto.randomUUID()}`,stamp=now(),canDiscover=discoveryConfigured();
 const approved=db.prepare(`SELECT id,name,'dispensary' record_type,country,region,website,phone FROM dispensaries WHERE active=1`).all() as any[];
 const candidates=db.prepare(`SELECT id,name,'candidate' record_type,country,region,website,phone FROM dispensary_candidates WHERE status<>'rejected'`).all() as any[];
 const records=[...approved,...candidates].filter(r=>(!scope.country||String(r.country||'')===scope.country)&&(!scope.region||String(r.region||'')===scope.region)&&(!scope.recordType||scope.recordType==='all'||r.record_type===scope.recordType)&&profileMissing(String(r.id),scope.missing||'any',r));
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare(`INSERT INTO dispensary_batch_jobs(id,created_by,scope_json,auto_apply,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run(id,actorId,JSON.stringify(scope),autoApply?1:0,records.length?'queued':'completed',stamp,stamp);
  const pending=db.prepare(`INSERT INTO dispensary_batch_items(id,job_id,location_id,location_name,record_type,status,stage,message,created_at,updated_at) VALUES(?,?,?,?,?,'pending','discovery',NULL,?,?)`);
  const blocked=db.prepare(`INSERT INTO dispensary_batch_items(id,job_id,location_id,location_name,record_type,status,stage,message,created_at,updated_at) VALUES(?,?,?,?,?,'blocked','discovery',?,?,?)`);
  for(const r of records){
   const locationId=String(r.id),state=profileState(locationId,r),itemId=`batch-item-${crypto.randomUUID()}`;
   if(!state.website&&!canDiscover)blocked.run(itemId,id,locationId,String(r.name),String(r.record_type),DISCOVERY_BLOCKED_MESSAGE,stamp,stamp);
   else pending.run(itemId,id,locationId,String(r.name),String(r.record_type),stamp,stamp);
  }
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 const job=getBatchJob(id);
 if(job&&job.counts?.pending===0)db.prepare(`UPDATE dispensary_batch_jobs SET status='completed',updated_at=? WHERE id=?`).run(now(),id);
 return getBatchJob(id);
}

export function getBatchJob(jobId:string){
 ensureSchema();const db=getDatabase();const job=db.prepare(`SELECT * FROM dispensary_batch_jobs WHERE id=?`).get(jobId) as any;if(!job)return null;
 const counts=db.prepare(`SELECT status,COUNT(*) count FROM dispensary_batch_items WHERE job_id=? GROUP BY status`).all(jobId) as any[];
 const byStatus=Object.fromEntries(counts.map(x=>[x.status,Number(x.count)]));
 const total=(Object.values(byStatus) as number[]).reduce((a,b)=>a+b,0);
 const reasons=(db.prepare(`SELECT status,message,COUNT(*) count FROM dispensary_batch_items WHERE job_id=? AND status IN ('blocked','failed','skipped') AND message IS NOT NULL GROUP BY status,message ORDER BY count DESC LIMIT 6`).all(jobId) as any[]).map(r=>({status:String(r.status),message:String(r.message),count:Number(r.count)}));
 return{...job,scope:JSON.parse(job.scope_json||'{}'),total,counts:byStatus,reasons};
}
export function listBatchJobs(limit=12){ensureSchema();const rows=getDatabase().prepare(`SELECT id FROM dispensary_batch_jobs ORDER BY created_at DESC LIMIT ?`).all(Math.min(50,Math.max(1,limit))) as {id:string}[];return rows.map(r=>getBatchJob(r.id));}
function queueReview(jobId:string,item:any,type:'discovery'|'enrichment',confidence:string,payload:any,score?:number){const db=getDatabase(),stamp=now();const existing=db.prepare(`SELECT id FROM dispensary_enrichment_review_queue WHERE item_id=? AND review_type=? AND status='pending'`).get(item.id,type) as any;if(!existing)db.prepare(`INSERT INTO dispensary_enrichment_review_queue(id,job_id,item_id,location_id,location_name,review_type,confidence,score,payload_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(`enrich-review-${crypto.randomUUID()}`,jobId,item.id,item.location_id,item.location_name,type,confidence,score??null,JSON.stringify(payload),stamp,stamp);db.prepare(`UPDATE dispensary_batch_items SET status='review',stage=?,message=?,result_json=?,updated_at=? WHERE id=?`).run(type,`Needs ${type} review.`,JSON.stringify(payload),stamp,item.id);}

async function processItem(item:any,job:any,actorId:string){
 const db=getDatabase(),locationId=String(item.location_id),autoApply=Boolean(job.auto_apply);db.prepare(`UPDATE dispensary_batch_items SET status='processing',updated_at=? WHERE id=?`).run(now(),item.id);
 try{
  const base=getLocationBase(locationId);if(!base)throw new Error('Location no longer exists.');const profile=getCommunityProfile(locationId);let website=profile?.website||base.website||'';
  if(!website){
   if(!discoveryConfigured()){db.prepare(`UPDATE dispensary_batch_items SET status='blocked',stage='discovery',message=?,updated_at=? WHERE id=?`).run(DISCOVERY_BLOCKED_MESSAGE,now(),item.id);return;}
   const discovery=await discoverOfficialSite(locationId,actorId,autoApply);const selected=discovery?.selected as any;
   if(!selected){queueReview(job.id,item,'discovery','low',discovery);return;}
   if(selected.confidence!=='high'||Number(selected.score||0)<75){queueReview(job.id,item,'discovery',selected.confidence||'low',discovery,Number(selected.score||0));return;}
   website=selected.url||'';if(!autoApply){queueReview(job.id,item,'discovery','high',discovery,Number(selected.score||0));return;}
  }
  const preview=await enrichFromOfficialWebsite(locationId,actorId,false);if(preview.confidence!=='high'){queueReview(job.id,item,'enrichment',preview.confidence,preview);return;}
  if(autoApply)await enrichFromOfficialWebsite(locationId,actorId,true);else{queueReview(job.id,item,'enrichment','high',preview);return;}
  db.prepare(`UPDATE dispensary_batch_items SET status='applied',stage='complete',message='High-confidence site and enrichment applied.',result_json=?,updated_at=? WHERE id=?`).run(JSON.stringify(preview),now(),item.id);
 }catch(e){db.prepare(`UPDATE dispensary_batch_items SET status='failed',message=?,updated_at=? WHERE id=?`).run(e instanceof Error?e.message:'Batch processing failed.',now(),item.id);}
}
export async function processBatchChunk(jobId:string,actorId:string,chunkSize=5){ensureSchema();const db=getDatabase(),job=db.prepare(`SELECT * FROM dispensary_batch_jobs WHERE id=?`).get(jobId) as any;if(!job)throw new Error('Batch job not found.');if(job.status==='completed')return getBatchJob(jobId);db.prepare(`UPDATE dispensary_batch_jobs SET status='running',updated_at=? WHERE id=?`).run(now(),jobId);const items=db.prepare(`SELECT * FROM dispensary_batch_items WHERE job_id=? AND status='pending' ORDER BY created_at,id LIMIT ?`).all(jobId,Math.min(10,Math.max(1,chunkSize))) as any[];for(const item of items)await processItem(item,job,actorId);const left=(db.prepare(`SELECT COUNT(*) count FROM dispensary_batch_items WHERE job_id=? AND status IN ('pending','processing')`).get(jobId) as any)?.count||0;db.prepare(`UPDATE dispensary_batch_jobs SET status=?,updated_at=? WHERE id=?`).run(left?'running':'completed',now(),jobId);return getBatchJob(jobId);}
export function listReviewQueue(status='pending',limit=100){ensureSchema();return (getDatabase().prepare(`SELECT * FROM dispensary_enrichment_review_queue WHERE status=? ORDER BY created_at ASC LIMIT ?`).all(status,Math.min(250,Math.max(1,limit))) as any[]).map((r:any)=>({...r,payload:JSON.parse(r.payload_json||'{}')}));}
export async function reviewQueueItem(reviewId:string,action:'approve'|'reject',actorId:string){ensureSchema();const db=getDatabase(),row=db.prepare(`SELECT * FROM dispensary_enrichment_review_queue WHERE id=? AND status='pending'`).get(reviewId) as any;if(!row)throw new Error('Review item not found or already reviewed.');const payload=JSON.parse(row.payload_json||'{}'),stamp=now();if(action==='approve'){if(row.review_type==='discovery'){const selected=payload?.selected;if(!selected?.url)throw new Error('No website candidate is available to approve.');const current=getCommunityProfile(row.location_id);upsertCommunityProfile(row.location_id,{overview:current?.overview,phone:current?.phone,website:selected.url,hours:current?.hours||{},amenities:current?.amenities||[],social:current?.social||{}},{type:'admin',id:actorId});const preview=await enrichFromOfficialWebsite(row.location_id,actorId,false);if(preview.confidence==='high'){await enrichFromOfficialWebsite(row.location_id,actorId,true);db.prepare(`UPDATE dispensary_batch_items SET status='applied',stage='complete',message='Discovery approved; high-confidence enrichment applied.',updated_at=? WHERE id=?`).run(stamp,row.item_id);}else{queueReview(row.job_id,{id:row.item_id,location_id:row.location_id,location_name:row.location_name},'enrichment',preview.confidence,preview);}}else{await enrichFromOfficialWebsite(row.location_id,actorId,true);db.prepare(`UPDATE dispensary_batch_items SET status='applied',stage='complete',message='Enrichment approved by admin.',updated_at=? WHERE id=?`).run(stamp,row.item_id);}}else db.prepare(`UPDATE dispensary_batch_items SET status='skipped',message='Rejected in enrichment review.',updated_at=? WHERE id=?`).run(stamp,row.item_id);db.prepare(`UPDATE dispensary_enrichment_review_queue SET status=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?`).run(action==='approve'?'approved':'rejected',actorId,stamp,stamp,reviewId);return{ok:true};}
