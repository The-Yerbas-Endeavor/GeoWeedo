import 'server-only';
import {getDatabase} from '@/lib/sqlite';

export const DEFAULT_REAUDIT_DAYS=90;
export type AuditState='never_verified'|'current'|'due'|'overdue';
export type ProfileVerification={locationId:string;lastVerifiedAt:string|null;nextAuditAt:string|null;verifiedBy:string|null;verificationSource:string|null;notes:string|null;auditState:AuditState;daysUntilAudit:number|null;daysOverdue:number};

export function ensureProfileVerificationSchema(){
 getDatabase().exec(`CREATE TABLE IF NOT EXISTS dispensary_profile_verifications(
  location_id TEXT PRIMARY KEY,
  last_verified_at TEXT,
  next_audit_at TEXT,
  verified_by TEXT,
  verification_source TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
 );CREATE INDEX IF NOT EXISTS dispensary_profile_verifications_due_idx ON dispensary_profile_verifications(next_audit_at);`);
}
function state(last:string|null,next:string|null){
 if(!last)return {auditState:'never_verified' as const,daysUntilAudit:null,daysOverdue:0};
 if(!next)return {auditState:'due' as const,daysUntilAudit:0,daysOverdue:0};
 const delta=Math.ceil((new Date(next).getTime()-Date.now())/86400000);
 if(delta<0)return {auditState:'overdue' as const,daysUntilAudit:delta,daysOverdue:Math.abs(delta)};
 if(delta===0)return {auditState:'due' as const,daysUntilAudit:0,daysOverdue:0};
 return {auditState:'current' as const,daysUntilAudit:delta,daysOverdue:0};
}
function decorate(locationId:string,row:any):ProfileVerification{
 const last=row?.last_verified_at||null,next=row?.next_audit_at||null;
 return {locationId,lastVerifiedAt:last,nextAuditAt:next,verifiedBy:row?.verified_by||null,verificationSource:row?.verification_source||null,notes:row?.notes||null,...state(last,next)};
}
export function getProfileVerification(locationId:string):ProfileVerification{
 ensureProfileVerificationSchema();
 const row=getDatabase().prepare(`SELECT location_id,last_verified_at,next_audit_at,verified_by,verification_source,notes FROM dispensary_profile_verifications WHERE location_id=?`).get(locationId) as any;
 return decorate(locationId,row);
}
export function getProfileAuditQueue(locationIds?:string[]){
 ensureProfileVerificationSchema();const db=getDatabase();
 const ids=(locationIds||[]).filter(Boolean),where=ids.length?`WHERE d.id IN (${ids.map(()=>'?').join(',')})`:'';
 const rows=db.prepare(`SELECT d.id location_id,d.name,d.city,d.region,d.country,v.last_verified_at,v.next_audit_at,v.verified_by,v.verification_source,v.notes
 FROM dispensaries d LEFT JOIN dispensary_profile_verifications v ON v.location_id=d.id
 ${where} ORDER BY CASE WHEN v.last_verified_at IS NULL THEN 0 WHEN v.next_audit_at IS NULL THEN 1 WHEN v.next_audit_at<=? THEN 2 ELSE 3 END,v.next_audit_at,d.name`).all(...ids,new Date().toISOString()) as any[];
 return rows.map(row=>({...row,...decorate(String(row.location_id),row)})).filter(row=>row.auditState!=='current');
}
export function markProfileVerified(locationId:string,actor:string,source='manual',notes='',reauditDays=DEFAULT_REAUDIT_DAYS){
 ensureProfileVerificationSchema();const db=getDatabase(),now=new Date(),next=new Date(now.getTime()+Math.max(1,reauditDays)*86400000),created=now.toISOString();
 db.prepare(`INSERT INTO dispensary_profile_verifications(location_id,last_verified_at,next_audit_at,verified_by,verification_source,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(location_id) DO UPDATE SET last_verified_at=excluded.last_verified_at,next_audit_at=excluded.next_audit_at,verified_by=excluded.verified_by,verification_source=excluded.verification_source,notes=excluded.notes,updated_at=excluded.updated_at`).run(locationId,created,next.toISOString(),actor,source,notes||null,created,created);
 return getProfileVerification(locationId);
}
