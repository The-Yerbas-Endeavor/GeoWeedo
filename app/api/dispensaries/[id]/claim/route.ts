import { NextRequest, NextResponse } from 'next/server';
import { getOwnerClaimForUser, submitOwnerClaim } from '@/lib/dispensaryCommunity';
import { getUserFromRequest } from '@/lib/userAuth';

export const runtime='nodejs';
type Context={params:Promise<{id:string}>};

export async function GET(request:NextRequest,{params}:Context){
 const user=getUserFromRequest(request);if(!user)return NextResponse.json({authenticated:false,claim:null},{headers:{'Cache-Control':'no-store'}});
 const {id}=await params;return NextResponse.json({authenticated:true,claim:getOwnerClaimForUser(id,user.id)},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:NextRequest,{params}:Context){
 const user=getUserFromRequest(request);if(!user)return NextResponse.json({error:'Sign in to claim this dispensary.'},{status:401});
 const {id}=await params;const body=await request.json().catch(()=>null);
 try{const claim=submitOwnerClaim({locationId:id,userId:user.id,claimantName:String(body?.claimantName||user.handle||''),businessEmail:String(body?.businessEmail||''),businessPhone:String(body?.businessPhone||''),roleTitle:String(body?.roleTitle||''),businessWebsite:String(body?.businessWebsite||''),evidenceText:String(body?.evidenceText||'')});return NextResponse.json({claim,message:'Ownership claim submitted for verification.'},{status:201});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not submit ownership claim.'},{status:400});}
}
