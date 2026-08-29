import { NextRequest,NextResponse } from 'next/server';
import { loginEmailUser,USER_COOKIE } from '@/lib/userAuth';
import { resolveRequestGeo } from '@/lib/requestGeo';

export const runtime='nodejs';

export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>null);const email=String(body?.email||'');const password=String(body?.password||'');
 if(!email||!password)return NextResponse.json({error:'Email and password are required.'},{status:400});
 try{
  const geo=await resolveRequestGeo(request);const login=loginEmailUser(email,password,request.headers.get('user-agent'),geo);
  if(!login)return NextResponse.json({error:'Invalid email or password.'},{status:401});
  const response=NextResponse.json({player:login.user});response.cookies.set(USER_COOKIE,login.token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',expires:login.expires});return response;
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Login failed.'},{status:400});}
}
