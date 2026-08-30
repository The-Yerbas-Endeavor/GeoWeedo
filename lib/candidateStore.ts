import 'server-only';

import crypto from 'crypto';
import { getDatabase } from '@/lib/sqlite';

export type DispensaryCandidate = {
  id: string; name: string; streetAddress?: string; city?: string; region?: string; country?: string;
  latitude?: number; longitude?: number; website?: string; licenseNumber?: string; dataSource: string;
  sourceUrl?: string; sourceLicense?: string; status: 'candidate'|'reviewing'|'approved'|'rejected';
  imageryStatus?: 'unchecked'|'coverage'|'no_coverage'|'missing_coordinates'|'error'; imageryCount?: number;
  imageryCheckedAt?: string; imageryMessage?: string; createdAt: string; updatedAt: string;
};

export type PipelineAssessment={eligible:boolean;reason?:string;official:boolean;supplemental:boolean};

const EXCLUDED_BUSINESS=/\b(cultivat(?:or|ion)|grower|producer|processor|manufacturer|manufacturing|wholesal(?:e|er)|distributor|distribution|laboratory|testing lab|transporter|delivery(?: service)?|courier|microbusiness)\b/i;
const SUPPLEMENTAL_SOURCE=/openstreetmap|osm|supplemental|fallback/i;
const BUSINESS_SUPPLIED=/business[- ]supplied/i;
const GENERIC_SOURCE=/official-license-registry|state-open-data/i;

export function assessCandidatePipeline(row:Pick<DispensaryCandidate,'name'|'streetAddress'|'city'|'region'|'country'|'licenseNumber'|'dataSource'|'sourceUrl'|'sourceLicense'>):PipelineAssessment{
  const name=String(row.name||'').trim();
  const source=String(row.dataSource||'').trim();
  const sourceUrl=String(row.sourceUrl||'').trim();
  const sourceLicense=String(row.sourceLicense||'').trim();
  const supplemental=SUPPLEMENTAL_SOURCE.test(`${source} ${sourceLicense}`);
  const businessSupplied=BUSINESS_SUPPLIED.test(source);
  const generic=GENERIC_SOURCE.test(source);
  const official=!supplemental&&!businessSupplied&&!generic&&Boolean(sourceUrl)&&Boolean(sourceLicense);
  if(!name)return{eligible:false,reason:'missing business name',official,supplemental};
  if(EXCLUDED_BUSINESS.test(name))return{eligible:false,reason:'non-retail cannabis business type',official,supplemental};
  if(!row.region?.trim()||!row.country?.trim())return{eligible:false,reason:'missing jurisdiction provenance',official,supplemental};
  if(!source)return{eligible:false,reason:'missing data source',official,supplemental};
  if(!sourceUrl)return{eligible:false,reason:'missing source URL',official,supplemental};
  if(!sourceLicense)return{eligible:false,reason:'missing source provenance/terms',official,supplemental};
  if(businessSupplied||generic)return{eligible:false,reason:'unverified/generic source is not eligible for public pipeline',official,supplemental};
  return{eligible:true,official,supplemental};
}

function optionalString(value:unknown){return value==null||value===''?undefined:String(value);}
function optionalNumber(value:unknown){return value==null?undefined:Number(value);}
function fingerprint(row:Pick<DispensaryCandidate,'name'|'streetAddress'|'city'|'region'>){return `${row.name}|${row.streetAddress||''}|${row.city||''}|${row.region||''}`.trim().toLowerCase();}
function rowToCandidate(row:Record<string,unknown>):DispensaryCandidate{return{id:String(row.id),name:String(row.name),streetAddress:optionalString(row.street_address),city:optionalString(row.city),region:optionalString(row.region),country:optionalString(row.country),latitude:optionalNumber(row.latitude),longitude:optionalNumber(row.longitude),website:optionalString(row.website),licenseNumber:optionalString(row.license_number),dataSource:String(row.data_source),sourceUrl:optionalString(row.source_url),sourceLicense:optionalString(row.source_license),status:String(row.status) as DispensaryCandidate['status'],imageryStatus:String(row.imagery_status||'unchecked') as NonNullable<DispensaryCandidate['imageryStatus']>,imageryCount:optionalNumber(row.imagery_count),imageryCheckedAt:optionalString(row.imagery_checked_at),imageryMessage:optionalString(row.imagery_message),createdAt:String(row.created_at),updatedAt:String(row.updated_at)};}

export async function listCandidates(){return(getDatabase().prepare('SELECT * FROM dispensary_candidates ORDER BY updated_at DESC').all() as Record<string,unknown>[]).map(rowToCandidate);}

export async function auditCandidatePipeline({apply=false}:{apply?:boolean}={}){
  const db=getDatabase();const rows=(db.prepare("SELECT * FROM dispensary_candidates WHERE status != 'rejected'").all() as Record<string,unknown>[]).map(rowToCandidate);
  const reasons:Record<string,number>={};const rejectedIds:string[]=[];
  const reject=db.prepare("UPDATE dispensary_candidates SET status='rejected', imagery_message=?, updated_at=? WHERE id=?");
  const now=new Date().toISOString();
  for(const row of rows){const assessment=assessCandidatePipeline(row);if(assessment.eligible)continue;const reason=assessment.reason||'pipeline policy failure';reasons[reason]=(reasons[reason]||0)+1;rejectedIds.push(row.id);if(apply)reject.run(`GeoWeedo data-pipeline cleanup: ${reason}.`,now,row.id);}
  return{scanned:rows.length,flagged:rejectedIds.length,rejected:apply?rejectedIds.length:0,reasons};
}

export async function importCandidates(rows:Omit<DispensaryCandidate,'id'|'status'|'createdAt'|'updatedAt'>[]){
 const db=getDatabase(),now=new Date().toISOString();
 const insert=db.prepare(`INSERT OR IGNORE INTO dispensary_candidates (id,fingerprint,name,street_address,city,region,country,latitude,longitude,website,license_number,data_source,source_url,source_license,status,imagery_status,imagery_count,imagery_checked_at,imagery_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
 const findByFingerprint=db.prepare('SELECT * FROM dispensary_candidates WHERE fingerprint = ? LIMIT 1');
 const findByLicense=db.prepare('SELECT * FROM dispensary_candidates WHERE license_number = ? AND country = ? LIMIT 1');
 const refresh=db.prepare(`UPDATE dispensary_candidates SET street_address=COALESCE(?,street_address),city=COALESCE(?,city),region=COALESCE(?,region),country=COALESCE(?,country),latitude=COALESCE(?,latitude),longitude=COALESCE(?,longitude),website=COALESCE(?,website),license_number=COALESCE(?,license_number),data_source=?,source_url=COALESCE(?,source_url),source_license=COALESCE(?,source_license),imagery_status=CASE WHEN ?=1 AND (latitude IS NULL OR longitude IS NULL) THEN 'unchecked' ELSE imagery_status END,updated_at=? WHERE id=?`);
 let added=0,updated=0,coordinatesUpdated=0,rejectedByPolicy=0;
 for(const row of rows){const assessment=assessCandidatePipeline(row);if(!assessment.eligible){rejectedByPolicy++;continue;}const fp=fingerprint(row),license=row.licenseNumber?.trim();const existing=((license&&row.country)?findByLicense.get(license,row.country):undefined) as Record<string,unknown>|undefined||findByFingerprint.get(fp) as Record<string,unknown>|undefined;if(existing){const had=Number.isFinite(existing.latitude)&&Number.isFinite(existing.longitude),has=Number.isFinite(row.latitude)&&Number.isFinite(row.longitude);const result=refresh.run(row.streetAddress??null,row.city??null,row.region??null,row.country??null,has?Number(row.latitude):null,has?Number(row.longitude):null,row.website??null,license??null,row.dataSource,row.sourceUrl??null,row.sourceLicense??null,has?1:0,now,String(existing.id));updated+=Number(result.changes);if(!had&&has)coordinatesUpdated++;continue;}const result=insert.run(`candidate-${crypto.randomUUID()}`,fp,row.name.trim(),row.streetAddress??null,row.city??null,row.region??null,row.country??null,row.latitude??null,row.longitude??null,row.website??null,license??null,row.dataSource,row.sourceUrl??null,row.sourceLicense??null,'candidate',row.imageryStatus||'unchecked',row.imageryCount??null,row.imageryCheckedAt??null,row.imageryMessage??null,now,now);added+=Number(result.changes);}
 const count=db.prepare('SELECT COUNT(*) AS count FROM dispensary_candidates').get() as {count:number}|undefined;return{added,updated,coordinatesUpdated,rejectedByPolicy,total:Number(count?.count??0)};
}

export async function updateCandidate(id:string,patch:Partial<DispensaryCandidate>){const db=getDatabase();const currentRow=db.prepare('SELECT * FROM dispensary_candidates WHERE id = ?').get(id) as Record<string,unknown>|undefined;if(!currentRow)return null;const current=rowToCandidate(currentRow),next:DispensaryCandidate={...current,...patch,id:current.id,updatedAt:new Date().toISOString()};db.prepare(`UPDATE dispensary_candidates SET fingerprint=?,name=?,street_address=?,city=?,region=?,country=?,latitude=?,longitude=?,website=?,license_number=?,data_source=?,source_url=?,source_license=?,status=?,imagery_status=?,imagery_count=?,imagery_checked_at=?,imagery_message=?,updated_at=? WHERE id=?`).run(fingerprint(next),next.name,next.streetAddress??null,next.city??null,next.region??null,next.country??null,next.latitude??null,next.longitude??null,next.website??null,next.licenseNumber??null,next.dataSource,next.sourceUrl??null,next.sourceLicense??null,next.status,next.imageryStatus||'unchecked',next.imageryCount??null,next.imageryCheckedAt??null,next.imageryMessage??null,next.updatedAt,id);return next;}
