import {NextRequest,NextResponse} from 'next/server';
import {getAdminFromRequest} from '@/lib/adminAuth';
import {discoverOfficialSite} from '@/lib/officialSiteDiscovery';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Admin authentication required.'},{status:401});try{const body=await request.json();const locationId=String(body?.locationId||'').trim();if(!locationId)return NextResponse.json({error:'locationId is required.'},{status:400});const result=await discoverOfficialSite(locationId,String(admin.id),Boolean(body?.apply));return NextResponse.json({ok:true,result});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Website discovery failed.'},{status:400});}}
