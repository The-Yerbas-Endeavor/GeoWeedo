import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/userAuth';
import { getCommunityProfile, getLocationBase, listPublicReviews, reviewSummary, submitReview } from '@/lib/dispensaryCommunity';

export const runtime='nodejs';

type Context={params:Promise<{id:string}>};

export async function GET(_request:NextRequest,{params}:Context){
 const {id}=await params;const base=getLocationBase(id);if(!base)return NextResponse.json({error:'Location not found.'},{status:404});
 const profile=getCommunityProfile(id);const ratings=reviewSummary(id);const reviews=listPublicReviews(id,25);
 return NextResponse.json({location:{...base,website:profile?.website||base.website,phone:profile?.phone||base.phone,overview:profile?.overview||null,hours:profile?.hours||{},amenities:profile?.amenities||[],social:profile?.social||{}},ratings,reviews});
}

export async function POST(request:NextRequest,{params}:Context){
 const user=getUserFromRequest(request);if(!user)return NextResponse.json({error:'Sign in to leave a review.'},{status:401});
 const {id}=await params;const body=await request.json().catch(()=>null);if(!body)return NextResponse.json({error:'Invalid review payload.'},{status:400});
 try{
  const result=submitReview({locationId:id,userId:user.id,author:user.handle,rating:Number(body.rating),title:String(body.title||''),body:String(body.body||'')});
  return NextResponse.json({ok:true,...result,message:'Review submitted for moderation.'});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Review submission failed.'},{status:400});}
}
