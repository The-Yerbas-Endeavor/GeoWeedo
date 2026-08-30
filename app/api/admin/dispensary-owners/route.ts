import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { assignDispensaryOwner } from '@/lib/dispensaryCommunity';
import { getDatabase } from '@/lib/sqlite';

export const runtime='nodejs';
export async function GET(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin||admin.role!=='admin')return NextResponse.json({error:'Forbidden'},{status:403});const rows=getDatabase().prepare(`SELECT o.*,a.username,a.display_name FROM dispensary_owner_assignments o JOIN admin_users a ON a.id=o.admin_user_id ORDER BY o.updated_at DESC`).all();return NextResponse.json({owners:rows});}
export async function POST(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin||admin.role!=='admin')return NextResponse.json({error:'Forbidden'},{status:403});const body=await request.json().catch(()=>null);const adminUserId=String(body?.adminUserId||''),locationId=String(body?.locationId||''),note=String(body?.note||'');if(!adminUserId||!locationId)return NextResponse.json({error:'adminUserId and locationId are required.'},{status:400});try{return NextResponse.json({ok:true,assignment:assignDispensaryOwner({adminUserId,locationId,verifiedBy:admin.id,note})});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Owner assignment failed.'},{status:400});}}
