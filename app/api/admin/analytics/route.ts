import { NextRequest, NextResponse } from 'next/server';
import { analyticsSummary } from '@/lib/analytics';
import { getAdminFromRequest } from '@/lib/adminAuth';

export const runtime='nodejs';

function clean(value:string|null,max=200){return String(value||'').trim().slice(0,max);}
function requestIp(request:NextRequest){return clean(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||request.headers.get('x-real-ip'),128);}

export async function GET(request:NextRequest){
 if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
 const daysRaw=Number(request.nextUrl.searchParams.get('days')||30);
 const days=Number.isFinite(daysRaw)?Math.min(90,Math.max(1,Math.round(daysRaw))):30;
 const excludeAdmin=request.nextUrl.searchParams.get('excludeAdmin')==='1';
 const excludeIps=String(request.nextUrl.searchParams.get('excludeIps')||'').split(',').map(v=>v.trim()).filter(Boolean).slice(0,20);
 return NextResponse.json({...analyticsSummary(days,{excludeAdmin,excludeIps}),currentAdminIp:requestIp(request)},{headers:{'Cache-Control':'no-store'}});
}
