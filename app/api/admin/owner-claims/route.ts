import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listOwnerClaims, moderateOwnerClaim, type OwnerClaimStatus } from '@/lib/dispensaryCommunity';

export const runtime='nodejs';

export async function GET(request:NextRequest){
 const admin=getAdminFromRequest(request);if(!admin||admin.role!=='admin')return NextResponse.json({error:'Forbidden.'},{status:403});
 const raw=request.nextUrl.searchParams.get('status');const status=raw==='pending'||raw==='approved'||raw==='rejected'?raw as OwnerClaimStatus:undefined;
 return NextResponse.json({claims:listOwnerClaims(status)},{headers:{'Cache-Control':'no-store'}});
}

export async function PATCH(request:NextRequest){
 const admin=getAdminFromRequest(request);if(!admin||admin.role!=='admin')return NextResponse.json({error:'Forbidden.'},{status:403});
 const body=await request.json().catch(()=>null);const claimId=String(body?.claimId||'');const status=body?.status==='approved'?'approved':body?.status==='rejected'?'rejected':null;
 if(!claimId||!status)return NextResponse.json({error:'claimId and approved/rejected status are required.'},{status:400});
 try{return NextResponse.json({ok:true,result:moderateOwnerClaim({claimId,status,adminId:admin.id,note:String(body?.note||'')})});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not moderate ownership claim.'},{status:400});}
}
