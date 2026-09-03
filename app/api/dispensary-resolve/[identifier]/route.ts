import { NextResponse } from 'next/server';
import { resolveDispensaryIdentifier } from '@/lib/dispensarySlug';

export const runtime='nodejs';
type Context={params:Promise<{identifier:string}>};

export async function GET(_request:Request,{params}:Context){
 const {identifier}=await params;
 const resolved=resolveDispensaryIdentifier(decodeURIComponent(identifier));
 if(!resolved)return NextResponse.json({error:'Dispensary not found.'},{status:404});
 return NextResponse.json({locationId:resolved.locationId,slug:resolved.slug},{headers:{'Cache-Control':'no-store'}});
}
