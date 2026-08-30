import { NextRequest, NextResponse } from 'next/server';
import { getCommunityProfile, listUserOwnedLocations, upsertCommunityProfile, userOwnerCanEdit } from '@/lib/dispensaryCommunity';
import { getUserFromRequest } from '@/lib/userAuth';

export const runtime='nodejs';

export async function GET(request:NextRequest){
 const user=getUserFromRequest(request);if(!user)return NextResponse.json({error:'Sign in required.'},{status:401});
 return NextResponse.json({owner:user,dispensaries:listUserOwnedLocations(user.id)},{headers:{'Cache-Control':'no-store'}});
}

export async function PATCH(request:NextRequest){
 const user=getUserFromRequest(request);if(!user)return NextResponse.json({error:'Sign in required.'},{status:401});
 const body=await request.json().catch(()=>null);const locationId=String(body?.locationId||'');if(!locationId)return NextResponse.json({error:'locationId is required.'},{status:400});
 if(!userOwnerCanEdit(user.id,locationId))return NextResponse.json({error:'You are not verified to edit this dispensary.'},{status:403});
 try{const profile=upsertCommunityProfile(locationId,{overview:String(body?.overview||''),phone:String(body?.phone||''),website:String(body?.website||''),hours:body?.hours&&typeof body.hours==='object'?body.hours:{},amenities:Array.isArray(body?.amenities)?body.amenities.map((v:unknown)=>String(v)):[],social:body?.social&&typeof body.social==='object'?body.social:{}},{type:'owner',id:user.id});return NextResponse.json({ok:true,profile:profile||getCommunityProfile(locationId)});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not save dispensary profile.'},{status:400});}
}
