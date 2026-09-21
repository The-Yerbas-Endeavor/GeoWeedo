import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/userAuth';
import {
  createOwnerSponsorshipRequest,
  listOwnerSponsorshipRequests,
  updateOwnerSponsorshipRequestStatus,
} from '@/lib/sponsorshipStore';

export const runtime='nodejs';

export async function GET(request:NextRequest){
  const user=getUserFromRequest(request);
  if(!user)return NextResponse.json({error:'Sign in required.'},{status:401});
  const locationId=String(request.nextUrl.searchParams.get('locationId')||'').trim();
  if(!locationId)return NextResponse.json({error:'locationId is required.'},{status:400});
  try{
    return NextResponse.json({requests:listOwnerSponsorshipRequests(user.id,locationId)},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Could not load sponsorship requests.'},{status:400});
  }
}

export async function POST(request:NextRequest){
  const user=getUserFromRequest(request);
  if(!user)return NextResponse.json({error:'Sign in required.'},{status:401});
  const body=await request.json().catch(()=>null);
  const locationId=String(body?.locationId||'').trim();
  if(!locationId)return NextResponse.json({error:'locationId is required.'},{status:400});
  try{
    const requestRow=createOwnerSponsorshipRequest(user.id,locationId,{
      requestType:body?.requestType==='game'?'game':'featured',
      billingInterval:body?.billingInterval==='annual'?'annual':'monthly',
      gameType:body?.gameType,
      durationCode:body?.durationCode,
      geographyType:body?.geographyType,
      geographyValue:body?.geographyValue,
      radiusKm:body?.radiusKm,
      preferredStartAt:body?.preferredStartAt||null,
      note:body?.note||null,
    });
    return NextResponse.json({request:requestRow},{status:201});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Could not submit sponsorship request.'},{status:400});
  }
}

export async function PATCH(request:NextRequest){
  const user=getUserFromRequest(request);
  if(!user)return NextResponse.json({error:'Sign in required.'},{status:401});
  const body=await request.json().catch(()=>null);
  const requestId=String(body?.requestId||'').trim();
  if(!requestId)return NextResponse.json({error:'requestId is required.'},{status:400});
  try{
    const requestRow=updateOwnerSponsorshipRequestStatus(user.id,requestId,'cancelled');
    return NextResponse.json({request:requestRow});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:'Could not cancel sponsorship request.'},{status:400});
  }
}
