import {NextRequest,NextResponse} from 'next/server';
import {attachEmailLogin,getUserFromRequest} from '@/lib/userAuth';
export const runtime='nodejs';
export async function POST(request:NextRequest){const user=getUserFromRequest(request);if(!user)return NextResponse.json({error:'Login required.'},{status:401});try{const body=await request.json(),email=String(body.email||''),password=String(body.password||'');const result=attachEmailLogin(user.id,email,password);return NextResponse.json({ok:true,...result});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not update login credentials.'},{status:400});}}
