import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getConfiguredImageryProvider, getGoogleDailyWarningLimit, getImageryProviderUsage } from '@/lib/imageryProviderSettings';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const requestedDays = Number(request.nextUrl.searchParams.get('days') || 7);
  const days = Math.min(90, Math.max(1, Number.isFinite(requestedDays) ? Math.floor(requestedDays) : 7));
  const usage = getImageryProviderUsage(days);
  const warningLimit = getGoogleDailyWarningLimit();
  const mapsKeyConfigured = Boolean(String(process.env.GOOGLE_MAPS_API_KEY || '').trim());
  const placesDedicatedKeyConfigured = Boolean(String(process.env.GOOGLE_PLACES_API_KEY || '').trim());

  return NextResponse.json({
    days,
    provider: getConfiguredImageryProvider(),
    envDefault: String(process.env.STREET_IMAGERY_PROVIDER || 'kartaview').trim().toLowerCase(),
    mapsKeyConfigured,
    placesDedicatedKeyConfigured,
    placesAvailable: placesDedicatedKeyConfigured || mapsKeyConfigured,
    placesKeySource: placesDedicatedKeyConfigured ? 'dedicated' : mapsKeyConfigured ? 'maps-fallback' : 'missing',
    warningLimit,
    warning: warningLimit > 0 && usage.googleImagesToday >= warningLimit,
    usage,
    accounting: {
      source: 'GeoWeedo server request counters',
      includesGoogleBilling: false,
      note: 'Counts reflect Google Street View requests made through GeoWeedo. Google Cloud billing, credits, quota consumption, and console-side traffic are not included.',
    },
  });
}
