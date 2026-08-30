import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';

export const runtime='nodejs';
export async function GET(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized'},{status:401});const db=getDatabase();if(admin.role==='admin'){return NextResponse.json({locations:[]});}if(admin.role!=='verified_dispensary')return NextResponse.json({error:'Forbidden'},{status:403});const rows=db.prepare(`SELECT o.location_id,o.status,COALESCE(d.name,c.name,'Assigned dispensary') name,COALESCE(d.city,c.city,'') city,COALESCE(d.region,c.region,'') region FROM dispensary_owner_assignments o LEFT JOIN dispensaries d ON d.id=o.location_id LEFT JOIN dispensary_candidates c ON c.id=o.location_id WHERE o.admin_user_id=? AND o.status='verified' ORDER BY name`).all(admin.id);return NextResponse.json({locations:rows});}
