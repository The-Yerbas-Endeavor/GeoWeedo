import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { getUserFromRequest, hashUserPassword } from '@/lib/userAuth';

export const runtime='nodejs';

function clean(value:unknown){return String(value??'').trim();}
function validEmail(value:string){return /^\S+@\S+\.\S+$/.test(value);}

export async function GET(request:NextRequest){
  const user=getUserFromRequest(request);
  if(!user)return NextResponse.json({error:'Login required.'},{status:401});
  const db=getDatabase();
  const row=db.prepare(`
    SELECT id,username,display_name,email,password_hash,yerbas_address,wallet_verified_at,reward_eligible,account_status,created_at,updated_at,last_login_at
    FROM users WHERE id=? LIMIT 1
  `).get(user.id) as any;
  if(!row)return NextResponse.json({error:'Account not found.'},{status:404});
  const now=new Date().toISOString();
  const sessions=db.prepare(`
    SELECT id,user_agent,created_at,last_seen_at,expires_at
    FROM user_sessions
    WHERE user_id=? AND revoked_at IS NULL AND expires_at>?
    ORDER BY last_seen_at DESC,created_at DESC
  `).all(user.id,now) as any[];
  return NextResponse.json({
    user:{
      id:row.id,
      handle:row.display_name||row.username||'Player',
      email:row.email||'',
      emailLoginEnabled:Boolean(row.email&&row.password_hash),
      yerbasAddress:row.yerbas_address||null,
      walletVerifiedAt:row.wallet_verified_at||null,
      rewardEligible:Boolean(row.reward_eligible),
      accountStatus:row.account_status||'active',
      createdAt:row.created_at||null,
      updatedAt:row.updated_at||null,
      lastLoginAt:row.last_login_at||null,
    },
    sessions:sessions.map(session=>({
      id:session.id,
      current:session.id===user.sessionId,
      userAgent:session.user_agent||'Unknown device/browser',
      createdAt:session.created_at||null,
      lastSeenAt:session.last_seen_at||null,
      expiresAt:session.expires_at||null,
    })),
  },{headers:{'Cache-Control':'no-store'}});
}

export async function PATCH(request:NextRequest){
  const user=getUserFromRequest(request);
  if(!user)return NextResponse.json({error:'Login required.'},{status:401});
  const body=await request.json().catch(()=>null);
  const action=clean(body?.action);
  const db=getDatabase();
  const now=new Date().toISOString();

  if(action==='profile'){
    const displayName=clean(body?.displayName);
    const email=clean(body?.email).toLowerCase();
    if(displayName.length<2||displayName.length>80)return NextResponse.json({error:'User name must be 2–80 characters.'},{status:400});
    if(email&&!validEmail(email))return NextResponse.json({error:'Enter a valid email address.'},{status:400});
    const nameOwner=db.prepare(`
      SELECT id FROM users
      WHERE id<>? AND (username=? OR display_name=?) COLLATE NOCASE
      LIMIT 1
    `).get(user.id,displayName,displayName) as any;
    if(nameOwner)return NextResponse.json({error:'That user name is already taken.'},{status:409});
    if(email){
      const emailOwner=db.prepare('SELECT id FROM users WHERE id<>? AND email=? COLLATE NOCASE LIMIT 1').get(user.id,email) as any;
      if(emailOwner)return NextResponse.json({error:'That email address is already used by another account.'},{status:409});
    }
    db.prepare('UPDATE users SET username=?,display_name=?,email=?,updated_at=? WHERE id=?')
      .run(displayName,displayName,email||null,now,user.id);
    return NextResponse.json({ok:true,displayName,email:email||null});
  }

  if(action==='password'){
    const password=String(body?.password||'');
    if(password.length<8)return NextResponse.json({error:'Password must be at least 8 characters.'},{status:400});
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?').run(hashUserPassword(password),now,user.id);
      const revoked=db.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL')
        .run(now,user.id,user.sessionId);
      db.exec('COMMIT');
      return NextResponse.json({ok:true,sessionsRevoked:Number(revoked.changes||0)});
    }catch(error){
      try{db.exec('ROLLBACK');}catch{}
      return NextResponse.json({error:error instanceof Error?error.message:'Could not update password.'},{status:400});
    }
  }

  if(action==='revoke_other_sessions'){
    const result=db.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL')
      .run(now,user.id,user.sessionId);
    return NextResponse.json({ok:true,revoked:Number(result.changes||0)});
  }

  return NextResponse.json({error:'Unknown account settings action.'},{status:400});
}
