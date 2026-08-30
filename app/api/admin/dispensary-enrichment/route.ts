import { NextRequest,NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { enrichFromOfficialWebsite } from '@/lib/dispensaryEnrichment';

export async function POST(request:NextRequest){
 const admin=getAdminFromRequest(request);if(!admin)return NextResponse.json({error:'Unauthorized.'},{status:401});
 const body=await request.json().catch(()=>null);if(!body?.locationId)return NextResponse.json({error:'locationId is required.'},{status:400});
 try{return NextResponse.json({result:await enrichFromOfficialWebsite(String(body.locationId),admin.id,Boolean(body.apply))});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Enrichment failed.'},{status:400});}
}
