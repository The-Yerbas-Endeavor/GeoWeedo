import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getUserFromRequest } from '@/lib/userAuth';
import { userOwnerCanEdit } from '@/lib/dispensaryCommunity';
import { getDispensaryLogo, removeDispensaryLogo, saveDispensaryLogo, type LogoActor } from '@/lib/dispensaryLogo';

export const runtime='nodejs';

function actorFor(request:NextRequest,locationId:string):LogoActor|null{
 const admin=getAdminFromRequest(request);
 if(admin)return{type:'admin',id:String(admin.id)};
 const user=getUserFromRequest(request);
 if(user&&userOwnerCanEdit(user.id,locationId))return{type:'owner',id:user.id};
 return null;
}

export async function GET(request:NextRequest){
 const locationId=String(request.nextUrl.searchParams.get('locationId')||'').trim();
 if(!locationId)return NextResponse.json({error:'locationId is required.'},{status:400});
 return NextResponse.json({logo:getDispensaryLogo(locationId)},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:NextRequest){
 const form=await request.formData().catch(()=>null);
 const locationId=String(form?.get('locationId')||'').trim();
 if(!locationId)return NextResponse.json({error:'locationId is required.'},{status:400});
 const actor=actorFor(request,locationId);
 if(!actor){const signedIn=Boolean(getUserFromRequest(request));return NextResponse.json({error:signedIn?'You are not verified to edit this dispensary.':'Sign in or Admin access required.'},{status:signedIn?403:401});}
 const file=form?.get('file');
 if(!(file instanceof File))return NextResponse.json({error:'Choose a logo image to upload.'},{status:400});
 try{
  const logo=await saveDispensaryLogo({locationId,bytes:new Uint8Array(await file.arrayBuffer()),mime:file.type,actor});
  return NextResponse.json({ok:true,logo});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not save logo.'},{status:400});}
}

export async function DELETE(request:NextRequest){
 const locationId=String(request.nextUrl.searchParams.get('locationId')||'').trim();
 if(!locationId)return NextResponse.json({error:'locationId is required.'},{status:400});
 const actor=actorFor(request,locationId);
 if(!actor){const signedIn=Boolean(getUserFromRequest(request));return NextResponse.json({error:signedIn?'You are not verified to edit this dispensary.':'Sign in or Admin access required.'},{status:signedIn?403:401});}
 await removeDispensaryLogo(locationId);
 return NextResponse.json({ok:true,logo:null});
}
