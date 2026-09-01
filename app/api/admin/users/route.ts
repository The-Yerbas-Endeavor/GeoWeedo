import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';

export const runtime='nodejs';
const ATOMIC=100_000_000;
const yerb=(value:any)=>Number(value||0)/ATOMIC;

function ensureAdminUserNotes(db:any){
  db.exec(`CREATE TABLE IF NOT EXISTS admin_user_notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    admin_user_id TEXT,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS admin_user_notes_user_idx ON admin_user_notes(user_id, created_at);`);
}
function ensureUserLoginLocations(db:any){
  db.exec(`CREATE TABLE IF NOT EXISTS user_login_locations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    ip_address TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    latitude REAL,
    longitude REAL,
    geo_source TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES user_sessions(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS user_login_locations_user_idx ON user_login_locations(user_id, created_at DESC);`);
}
function audit(db:any,adminId:string,action:string,userId:string,metadata:any={}){
  db.prepare(`INSERT INTO audit_log (id,actor_type,actor_id,action,entity_type,entity_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(`audit-${crypto.randomUUID()}`,'admin',adminId,action,'user',userId,JSON.stringify(metadata),new Date().toISOString());
}

export async function GET(request:NextRequest){
  if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
  const db=getDatabase();ensureAdminUserNotes(db);ensureUserLoginLocations(db);
  const id=request.nextUrl.searchParams.get('id');
  if(!id){
    const users=db.prepare(`SELECT u.id,u.username,u.display_name AS displayName,u.email,u.yerbas_address AS yerbasAddress,u.wallet_verified_at AS walletVerifiedAt,u.reward_eligible AS rewardEligible,u.account_status AS accountStatus,u.last_login_at AS lastLoginAt,u.created_at AS createdAt,w.id AS walletId,
      COALESCE((SELECT SUM(l.amount_atomic) FROM wallet_ledger l WHERE l.wallet_id=w.id AND l.status='posted'),0) AS balanceAtomic,
      COALESCE((SELECT COUNT(*) FROM deposits d WHERE d.wallet_id=w.id),0) AS depositCount,
      COALESCE((SELECT COUNT(*) FROM withdrawals x WHERE x.wallet_id=w.id),0) AS withdrawalCount,
      COALESCE((SELECT COUNT(*) FROM games g WHERE g.user_id=u.id),0) AS gameCount,
      COALESCE((SELECT COUNT(*) FROM user_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at > datetime('now')),0) AS activeSessionCount,
      (SELECT ip_address FROM user_login_locations x WHERE x.user_id=u.id ORDER BY x.created_at DESC LIMIT 1) AS lastIpAddress,
      (SELECT city FROM user_login_locations x WHERE x.user_id=u.id ORDER BY x.created_at DESC LIMIT 1) AS lastGeoCity,
      (SELECT region FROM user_login_locations x WHERE x.user_id=u.id ORDER BY x.created_at DESC LIMIT 1) AS lastGeoRegion,
      (SELECT country FROM user_login_locations x WHERE x.user_id=u.id ORDER BY x.created_at DESC LIMIT 1) AS lastGeoCountry
      FROM users u LEFT JOIN wallets w ON w.user_id=u.id ORDER BY COALESCE(u.display_name,u.username,u.yerbas_address,u.id) COLLATE NOCASE`).all().map((r:any)=>({...r,rewardEligible:Boolean(r.rewardEligible),balanceYerb:yerb(r.balanceAtomic)}));
    return NextResponse.json({users},{headers:{'Cache-Control':'no-store'}});
  }
  const user=db.prepare(`SELECT u.*,w.id AS wallet_id,w.status AS wallet_status FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE u.id=?`).get(id) as any;
  if(!user)return NextResponse.json({error:'User not found.'},{status:404});
  const walletId=user.wallet_id;
  const ledger=walletId?db.prepare(`SELECT id,entry_type,amount_atomic,status,reference_type,reference_id,txid,memo,created_at,posted_at FROM wallet_ledger WHERE wallet_id=? ORDER BY created_at DESC LIMIT 100`).all(walletId):[];
  const deposits=walletId?db.prepare(`SELECT id,address,txid,vout,amount_atomic,confirmations,status,detected_at,confirmed_at FROM deposits WHERE wallet_id=? ORDER BY detected_at DESC LIMIT 100`).all(walletId):[];
  const withdrawals=walletId?db.prepare(`SELECT id,destination_address,amount_atomic,fee_atomic,status,requested_at,reviewed_at,sent_at,txid,failure_reason FROM withdrawals WHERE wallet_id=? ORDER BY requested_at DESC LIMIT 100`).all(walletId):[];
  const rewards=walletId?db.prepare(`SELECT id,entry_type,amount_atomic,status,reference_type,reference_id,memo,txid,created_at,posted_at FROM wallet_ledger WHERE wallet_id=? AND (entry_type IN ('reward_pending','reward_credit') OR reference_type IN ('reward','game_reward','admin_reward')) ORDER BY created_at DESC LIMIT 100`).all(walletId):[];
  const games=db.prepare(`SELECT id,mode,status,total_score,reward_atomic,reward_status,started_at,completed_at FROM games WHERE user_id=? ORDER BY started_at DESC LIMIT 100`).all(id);
  const notes=db.prepare(`SELECT n.id,n.note,n.created_at,a.username AS adminUsername,a.display_name AS adminDisplayName FROM admin_user_notes n LEFT JOIN admin_users a ON a.id=n.admin_user_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100`).all(id);
  const loginHistory=db.prepare(`SELECT id,ip_address AS ipAddress,city,region,country,latitude,longitude,geo_source AS geoSource,user_agent AS userAgent,created_at AS createdAt FROM user_login_locations WHERE user_id=? ORDER BY created_at DESC LIMIT 25`).all(id) as any[];
  const latestLogin=loginHistory[0]||null;
  const activeSessions=Number((db.prepare(`SELECT COUNT(*) AS value FROM user_sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at > ?`).get(id,new Date().toISOString()) as any)?.value||0);
  const balanceAtomic=walletId?Number((db.prepare(`SELECT COALESCE(SUM(amount_atomic),0) AS value FROM wallet_ledger WHERE wallet_id=? AND status='posted'`).get(walletId) as any)?.value||0):0;
  return NextResponse.json({user:{id:user.id,username:user.username,displayName:user.display_name,email:user.email,yerbasAddress:user.yerbas_address,walletVerifiedAt:user.wallet_verified_at,rewardEligible:Boolean(user.reward_eligible),accountStatus:user.account_status,lastLoginAt:user.last_login_at,createdAt:user.created_at,walletId,walletStatus:user.wallet_status,balanceYerb:yerb(balanceAtomic),activeSessions,lastIpAddress:latestLogin?.ipAddress||null,lastGeoCity:latestLogin?.city||null,lastGeoRegion:latestLogin?.region||null,lastGeoCountry:latestLogin?.country||null,lastGeoLatitude:latestLogin?.latitude??null,lastGeoLongitude:latestLogin?.longitude??null,lastGeoSource:latestLogin?.geoSource||null},ledger:ledger.map((r:any)=>({...r,amountYerb:yerb(r.amount_atomic)})),deposits:deposits.map((r:any)=>({...r,amountYerb:yerb(r.amount_atomic)})),withdrawals:withdrawals.map((r:any)=>({...r,amountYerb:yerb(r.amount_atomic),feeYerb:yerb(r.fee_atomic)})),rewards:rewards.map((r:any)=>({...r,amountYerb:yerb(r.amount_atomic)})),games:games.map((r:any)=>({...r,rewardYerb:yerb(r.reward_atomic)})),notes,loginHistory},{headers:{'Cache-Control':'no-store'}});
}

export async function PATCH(request:NextRequest){
  const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});
  const body=await request.json().catch(()=>null);const userId=String(body?.userId||'');const action=String(body?.action||'');
  if(!userId||!action)return NextResponse.json({error:'userId and action are required.'},{status:400});
  const db=getDatabase();ensureAdminUserNotes(db);
  const existing=db.prepare(`SELECT id,account_status,reward_eligible FROM users WHERE id=?`).get(userId) as any;if(!existing)return NextResponse.json({error:'User not found.'},{status:404});
  const now=new Date().toISOString();
  if(action==='set_status'){
    const status=String(body?.status||'');if(!['active','suspended'].includes(status))return NextResponse.json({error:'Status must be active or suspended.'},{status:400});
    db.prepare(`UPDATE users SET account_status=?,updated_at=? WHERE id=?`).run(status,now,userId);
    if(status==='suspended')db.prepare(`UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`).run(now,userId);
    audit(db,admin.id,'user.status_changed',userId,{from:existing.account_status,to:status});
  }else if(action==='set_reward_eligible'){
    const enabled=Boolean(body?.enabled);db.prepare(`UPDATE users SET reward_eligible=?,updated_at=? WHERE id=?`).run(enabled?1:0,now,userId);audit(db,admin.id,'user.reward_eligibility_changed',userId,{enabled});
  }else if(action==='revoke_sessions'){
    const result=db.prepare(`UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`).run(now,userId);audit(db,admin.id,'user.sessions_revoked',userId,{changes:Number(result.changes||0)});
  }else if(action==='add_note'){
    const note=String(body?.note||'').trim();if(!note)return NextResponse.json({error:'Note cannot be empty.'},{status:400});
    db.prepare(`INSERT INTO admin_user_notes (id,user_id,admin_user_id,note,created_at) VALUES (?,?,?,?,?)`).run(`note-${crypto.randomUUID()}`,userId,admin.id,note,now);audit(db,admin.id,'user.note_added',userId,{preview:note.slice(0,120)});
  }else return NextResponse.json({error:'Unknown action.'},{status:400});
  return NextResponse.json({ok:true});
}

export async function DELETE(request:NextRequest){
  const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});
  const body=await request.json().catch(()=>null);const userId=String(body?.userId||'');
  if(!userId)return NextResponse.json({error:'userId is required.'},{status:400});
  const db=getDatabase();ensureAdminUserNotes(db);ensureUserLoginLocations(db);
  const user=db.prepare(`SELECT u.id,u.username,u.display_name AS displayName,u.email,w.id AS walletId FROM users u LEFT JOIN wallets w ON w.user_id=u.id WHERE u.id=?`).get(userId) as any;
  if(!user)return NextResponse.json({error:'User not found.'},{status:404});

  if(user.walletId){
    const balanceAtomic=Number((db.prepare(`SELECT COALESCE(SUM(amount_atomic),0) AS value FROM wallet_ledger WHERE wallet_id=? AND status='posted'`).get(user.walletId) as any)?.value||0);
    const ledgerCount=Number((db.prepare(`SELECT COUNT(*) AS value FROM wallet_ledger WHERE wallet_id=?`).get(user.walletId) as any)?.value||0);
    const depositCount=Number((db.prepare(`SELECT COUNT(*) AS value FROM deposits WHERE wallet_id=?`).get(user.walletId) as any)?.value||0);
    const withdrawalCount=Number((db.prepare(`SELECT COUNT(*) AS value FROM withdrawals WHERE wallet_id=?`).get(user.walletId) as any)?.value||0);
    const rewardClaimCount=Number((db.prepare(`SELECT COUNT(*) AS value FROM reward_claims WHERE wallet_id=?`).get(user.walletId) as any)?.value||0);
    if(balanceAtomic!==0||ledgerCount||depositCount||withdrawalCount||rewardClaimCount){
      return NextResponse.json({error:'This account has YERB financial history and cannot be permanently deleted. Suspend the account instead.'},{status:409});
    }
  }

  const metadata={username:user.username||null,displayName:user.displayName||null,email:user.email||null};
  try{
    db.exec('BEGIN IMMEDIATE');
    db.prepare(`DELETE FROM users WHERE id=?`).run(userId);
    audit(db,admin.id,'user.deleted',userId,metadata);
    db.exec('COMMIT');
  }catch(error){
    try{db.exec('ROLLBACK');}catch{}
    return NextResponse.json({error:error instanceof Error?error.message:'User deletion failed.'},{status:400});
  }
  return NextResponse.json({ok:true});
}
