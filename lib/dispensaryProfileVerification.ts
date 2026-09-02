import 'server-only';
import {getDatabase} from '@/lib/sqlite';

export const DEFAULT_REAUDIT_DAYS=90;

export type ProfileVerification={locationId:string;lastVerifiedAt:string|null;nextAuditAt:string|null;verifiedBy:string|null;verificationSource:string|null;notes:string|null};

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

export function getProfileVerification(locationId:string):ProfileVerification{
 ensureProfileVerificationSchema();
 const row=getDatabase().prepare(`SELECT location_id,last_verified_at,next_audit_at,verified_by,verification_source,notes FROM dispensary_profile_verifications WHERE location_id=?`).get(locationId) as any;
 return {locationId,lastVerifiedAt:row?.last_verified_at||null,nextAuditAt:row?.next_audit_at||null,verifiedBy:row?.verified_by||null,verificationSource:row?.verification_source||null,notes:row?.notes||null};
}

export function markProfileVerified(locationId:string,actor:string,source='manual',notes='',reauditDays=DEFAULT_REAUDIT_DAYS){
 ensureProfileVerificationSchema();const db=getDatabase(),now=new Date(),next=new Date(now.getTime()+Math.max(1,reauditDays)*86400000),created=now.toISOString();
 db.prepare(`INSERT INTO dispensary_profile_verifications(location_id,last_verified_at,next_audit_at,verified_by,verification_source,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(location_id) DO UPDATE SET last_verified_at=excluded.last_verified_at,next_audit_at=excluded.next_audit_at,verified_by=excluded.verified_by,verification_source=excluded.verification_source,notes=excluded.notes,updated_at=excluded.updated_at`).run(locationId,created,next.toISOString(),actor,source,notes||null,created,created);
 return getProfileVerification(locationId);
}
