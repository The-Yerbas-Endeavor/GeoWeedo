import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { ensureScoutSchema, listScouts, scoutSummary } from '@/lib/scouts';
import { getDatabase } from '@/lib/sqlite';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(request:NextRequest){
  if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
  ensureScoutSchema();
  return NextResponse.json({summary:scoutSummary(),scouts:listScouts()},{headers:{'Cache-Control':'no-store'}});
}

export async function PATCH(request:NextRequest){
  if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
  ensureScoutSchema();
  const body=await request.json().catch(()=>null);
  const userId=String(body?.userId||'');
  const enabled=Boolean(body?.enabled);
  if(!userId)return NextResponse.json({error:'userId is required.'},{status:400});
  const db=getDatabase(),now=new Date().toISOString();
  const user=db.prepare('SELECT id FROM users WHERE id=?').get(userId);
  if(!user)return NextResponse.json({error:'User not found.'},{status:404});
  db.prepare(`UPDATE users SET scout_enabled=?,scout_status=?,scout_since=CASE WHEN ?=1 THEN COALESCE(scout_since,?) ELSE scout_since END,updated_at=? WHERE id=?`)
    .run(enabled?1:0,enabled?'active':'suspended',enabled?1:0,now,now,userId);
  return NextResponse.json({ok:true,summary:scoutSummary(),scouts:listScouts()});
}
