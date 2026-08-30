import { NextRequest, NextResponse } from 'next/server';
import { analyticsSummary } from '@/lib/analytics';

export const runtime='nodejs';

export async function GET(request:NextRequest){
 const daysRaw=Number(request.nextUrl.searchParams.get('days')||30);
 const days=Number.isFinite(daysRaw)?Math.min(90,Math.max(1,Math.round(daysRaw))):30;
 return NextResponse.json(analyticsSummary(days),{headers:{'Cache-Control':'no-store'}});
}
