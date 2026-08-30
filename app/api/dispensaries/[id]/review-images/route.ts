import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/userAuth';
import { addReviewImage } from '@/lib/dispensaryCommunity';

export const runtime='nodejs';
type Context={params:Promise<{id:string}>};

export async function POST(request:NextRequest,{params}:Context){
 const user=getUserFromRequest(request);if(!user)return NextResponse.json({error:'Sign in to upload review photos.'},{status:401});
 const {id}=await params;const form=await request.formData().catch(()=>null);const file=form?.get('file');if(!(file instanceof File))return NextResponse.json({error:'Choose an image to upload.'},{status:400});
 try{const bytes=new Uint8Array(await file.arrayBuffer());const result=await addReviewImage({locationId:id,userId:user.id,bytes,mime:file.type});return NextResponse.json({ok:true,...result,message:'Photo uploaded for moderation.'});}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Photo upload failed.'},{status:400});}
}
