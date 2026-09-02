import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getConfiguredImageryProvider, getGoogleDailyWarningLimit, getGooglePanoramaUsageForCurrentMonth, getImageryProviderUsage } from '@/lib/imageryProviderSettings';

export const runtime = 'nodejs';

const DYNAMIC_STREET_VIEW_FREE_MONTHLY = 5000;
const DYNAMIC_STREET_VIEW_USD_PER_1000 = 14;

function estimateCost(events:number){
  const billable=Math.max(0,events-DYNAMIC_STREET_VIEW_FREE_MONTHLY);
  return { billableEvents:billable, estimatedUsd:(billable/1000)*DYNAMIC_STREET_VIEW_USD_PER_1000 };
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const requestedDays=Number(request.nextUrl.searchParams.get('days')||7);
  const days=Math.min(90,Math.max(1,Number.isFinite(requestedDays)?Math.floor(requestedDays):7));
  const usage=getImageryProviderUsage(days);
  const month=getGooglePanoramaUsageForCurrentMonth();
  const warningLimit=getGoogleDailyWarningLimit();
  const mapsKeyConfigured=Boolean(String(process.env.GOOGLE_MAPS_API_KEY||'').trim());
  const placesDedicatedKeyConfigured=Boolean(String(process.env.GOOGLE_PLACES_API_KEY||'').trim());
  const now=new Date();
  const daysInMonth=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).getUTCDate();
  const elapsedDays=Math.max(1,now.getUTCDate());
  const projectedEvents=Math.round((month.total/elapsedDays)*daysInMonth);
  const currentEstimate=estimateCost(month.total);
  const projectedEstimate=estimateCost(projectedEvents);
  const allowancePct=(month.total/DYNAMIC_STREET_VIEW_FREE_MONTHLY)*100;
  const warningLevel=allowancePct>=100?100:allowancePct>=90?90:allowancePct>=75?75:allowancePct>=50?50:0;

  return NextResponse.json({
    days,provider:getConfiguredImageryProvider(),envDefault:String(process.env.STREET_IMAGERY_PROVIDER||'kartaview').trim().toLowerCase(),mapsKeyConfigured,placesDedicatedKeyConfigured,
    placesAvailable:placesDedicatedKeyConfigured||mapsKeyConfigured,placesKeySource:placesDedicatedKeyConfigured?'dedicated':mapsKeyConfigured?'maps-fallback':'missing',warningLimit,warning:warningLimit>0&&usage.googleImagesToday>=warningLimit,usage,
    cost:{sku:'Dynamic Street View',currency:'USD',pricingModel:'Google Maps Platform pay-as-you-go estimate',freeMonthlyEvents:DYNAMIC_STREET_VIEW_FREE_MONTHLY,usdPer1000:DYNAMIC_STREET_VIEW_USD_PER_1000,monthEvents:month.total,monthRows:month.rows,allowancePct,remainingFreeEvents:Math.max(0,DYNAMIC_STREET_VIEW_FREE_MONTHLY-month.total),billableEvents:currentEstimate.billableEvents,estimatedMonthCostUsd:currentEstimate.estimatedUsd,projectedMonthEvents:projectedEvents,projectedMonthCostUsd:projectedEstimate.estimatedUsd,warningLevel,warningThresholds:[50,75,90,100],billingMonthUtc:`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`},isEstimate:true},
    accounting:{source:'GeoWeedo server request counters',includesGoogleBilling:false,note:'ESTIMATE ONLY. Panorama counts are recorded by GeoWeedo when it instantiates a Google Dynamic Street View panorama. Estimated cost applies Google pay-as-you-go list pricing to those observed events. Google Cloud billing, account credits, negotiated pricing, subscription plans, quota-side adjustments, failed/duplicate billing classification, and traffic outside GeoWeedo are not included.'},
  });
}
