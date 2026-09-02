import { NextResponse } from 'next/server';
import { readDispensaryLogoFile } from '@/lib/dispensaryLogo';

export const runtime='nodejs';
type Context={params:Promise<{file:string}>};

export async function GET(_request:Request,{params}:Context){
 const {file}=await params;
 const data=await readDispensaryLogoFile(file);
 if(!data)return new NextResponse('Not found',{status:404});
 const contentType=file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':'image/jpeg';
 return new NextResponse(new Uint8Array(data),{headers:{'Content-Type':contentType,'Cache-Control':'public, max-age=86400, immutable','X-Content-Type-Options':'nosniff'}});
}
