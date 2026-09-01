import { NextRequest,NextResponse } from 'next/server';
import { loginEmailUser,USER_COOKIE } from '@/lib/userAuth';
import { resolveRequestGeo } from '@/lib/requestGeo';

export const runtime='nodejs';

export async function POST(request:NextRequest){
 const body=await request.json().catch(()=>null);const identifier=String(body?.identifier||body?.email||'');const password=String(body?.password||'');
 if(!identifier||!password)return NextResponse.json({error:'User name/email and password are required.'},{status:400});
 try{
  const geo=await resolveRequestGeo(request);const login=loginEmailUser(identifier,password,request.headers.get('user-agent'),geo);
  if(!login)return NextResponse.json({error:'Invalid user name/email or password.'},{status:401});
  const response=NextResponse.json({player:login.user});response.cookies.set(USER_COOKIE,login.token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',expires:login.expires});return response;
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Login failed.'},{status:400});}
}
