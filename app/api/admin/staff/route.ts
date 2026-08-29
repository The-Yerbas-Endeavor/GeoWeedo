import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest, hashAdminPassword } from '@/lib/adminAuth';
import { ADMIN_PERMISSIONS, ROLE_PERMISSIONS, normalizeAdminRole, type AdminPermission } from '@/lib/adminPermissions';
import { getDatabase } from '@/lib/sqlite';

export const runtime='nodejs';

function cleanPermissions(value:unknown,role:string):AdminPermission[]{
  if(normalizeAdminRole(role)==='admin')return [...ROLE_PERMISSIONS.admin];
  if(!Array.isArray(value))return [...ROLE_PERMISSIONS.moderator];
  return value.filter((item):item is AdminPermission=>typeof item==='string'&&ADMIN_PERMISSIONS.includes(item as AdminPermission));
}

function listStaff(){
  const rows=getDatabase().prepare(`SELECT id,username,display_name,role,permissions_json,active,last_login_at,created_at,updated_at FROM admin_users ORDER BY active DESC, role, username COLLATE NOCASE`).all() as any[];
  return rows.map(row=>({id:row.id,username:row.username,displayName:row.display_name||'',role:normalizeAdminRole(row.role),permissions:cleanPermissions(row.permissions_json?JSON.parse(row.permissions_json):null,row.role),active:Boolean(row.active),lastLoginAt:row.last_login_at,createdAt:row.created_at,updatedAt:row.updated_at}));
}

export async function GET(request:NextRequest){
  const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});
  return NextResponse.json({staff:listStaff(),permissionLabels:Object.fromEntries(ADMIN_PERMISSIONS.map(p=>[p,p])),roleDefaults:ROLE_PERMISSIONS});
}

export async function POST(request:NextRequest){
  const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});
  const body=await request.json().catch(()=>({}));const username=String(body.username||'').trim(),displayName=String(body.displayName||'').trim(),password=String(body.password||''),role=normalizeAdminRole(body.role);
  if(!/^[A-Za-z0-9._-]{3,40}$/.test(username))return NextResponse.json({error:'Username must be 3–40 characters using letters, numbers, dot, dash, or underscore.'},{status:400});
  if(password.length<12)return NextResponse.json({error:'Staff passwords must be at least 12 characters.'},{status:400});
  const permissions=cleanPermissions(body.permissions,role),now=new Date().toISOString(),id=`au-${crypto.randomUUID()}`;
  try{getDatabase().prepare(`INSERT INTO admin_users (id,username,display_name,password_hash,role,permissions_json,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(id,username,displayName||null,hashAdminPassword(password),role,JSON.stringify(role==='admin'?[]:permissions),1,now,now);}catch(error){return NextResponse.json({error:error instanceof Error&&/UNIQUE/i.test(error.message)?'That staff username already exists.':'Could not create staff account.'},{status:400});}
  return NextResponse.json({staff:listStaff()},{status:201});
}

export async function PATCH(request:NextRequest){
  const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});
  const body=await request.json().catch(()=>({})),id=String(body.id||'');if(!id)return NextResponse.json({error:'Staff id is required.'},{status:400});
  const db=getDatabase(),existing=db.prepare('SELECT id,role,active FROM admin_users WHERE id=?').get(id) as any;if(!existing)return NextResponse.json({error:'Staff account not found.'},{status:404});
  const nextRole=body.role===undefined?normalizeAdminRole(existing.role):normalizeAdminRole(body.role),nextActive=body.active===undefined?Boolean(existing.active):Boolean(body.active);
  if(normalizeAdminRole(existing.role)==='admin'&&Boolean(existing.active)&&(!nextActive||nextRole!=='admin')){const activeAdmins=(db.prepare("SELECT COUNT(*) AS count FROM admin_users WHERE active=1 AND role='admin'").get() as any).count;if(Number(activeAdmins)<=1)return NextResponse.json({error:'GeoWeedo must keep at least one active administrator.'},{status:400});}
  if(id===admin.id&&!nextActive)return NextResponse.json({error:'You cannot deactivate your own staff account.'},{status:400});
  const current=db.prepare('SELECT permissions_json,display_name FROM admin_users WHERE id=?').get(id) as any;const permissions=cleanPermissions(body.permissions===undefined?(current.permissions_json?JSON.parse(current.permissions_json):null):body.permissions,nextRole),now=new Date().toISOString();
  db.prepare('UPDATE admin_users SET display_name=?, role=?, permissions_json=?, active=?, updated_at=? WHERE id=?').run(body.displayName===undefined?current.display_name:String(body.displayName||'').trim()||null,nextRole,JSON.stringify(nextRole==='admin'?[]:permissions),nextActive?1:0,now,id);
  if(typeof body.password==='string'&&body.password){if(body.password.length<12)return NextResponse.json({error:'Staff passwords must be at least 12 characters.'},{status:400});db.prepare('UPDATE admin_users SET password_hash=?, updated_at=? WHERE id=?').run(hashAdminPassword(body.password),now,id);db.prepare('UPDATE admin_sessions SET revoked_at=? WHERE admin_user_id=? AND revoked_at IS NULL').run(now,id);}
  return NextResponse.json({staff:listStaff()});
}
