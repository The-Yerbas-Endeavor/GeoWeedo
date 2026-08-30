import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import {
  getConfiguredImageryProvider,
  getGoogleDailyWarningLimit,
  getImageryProviderUsage,
  setConfiguredImageryProvider,
  setGoogleDailyWarningLimit,
  type ImageryProvider,
} from '@/lib/imageryProviderSettings';

export const runtime = 'nodejs';

function adminId(admin: ReturnType<typeof getAdminFromRequest>) {
  if (!admin || typeof admin !== 'object') return null;
  const value = (admin as Record<string, unknown>).id ?? (admin as Record<string, unknown>).adminUserId;
  return value ? String(value) : null;
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const usage = getImageryProviderUsage(7);
  const warningLimit = getGoogleDailyWarningLimit();
  return NextResponse.json({
    provider: getConfiguredImageryProvider(),
    envDefault: String(process.env.STREET_IMAGERY_PROVIDER || 'kartaview').toLowerCase(),
    googleConfigured: Boolean(String(process.env.GOOGLE_MAPS_API_KEY || '').trim()),
    warningLimit,
    warning: warningLimit > 0 && usage.googleImagesToday >= warningLimit,
    usage,
  });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const provider = String(body?.provider || '').trim().toLowerCase() as ImageryProvider;
  if (!['google', 'kartaview', 'auto'].includes(provider)) {
    return NextResponse.json({ error: 'Provider must be google, kartaview, or auto.' }, { status: 400 });
  }
  const warningLimit = Number(body?.warningLimit);
  if (!Number.isFinite(warningLimit) || warningLimit < 0 || warningLimit > 1000000) {
    return NextResponse.json({ error: 'Daily Google warning limit must be between 0 and 1,000,000.' }, { status: 400 });
  }
  if (provider === 'google' && !String(process.env.GOOGLE_MAPS_API_KEY || '').trim()) {
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY is not configured on the server.' }, { status: 409 });
  }
  const id = adminId(admin);
  setConfiguredImageryProvider(provider, id);
  setGoogleDailyWarningLimit(warningLimit, id);
  const usage = getImageryProviderUsage(7);
  return NextResponse.json({
    ok: true,
    provider,
    warningLimit: Math.floor(warningLimit),
    warning: warningLimit > 0 && usage.googleImagesToday >= warningLimit,
    usage,
  });
}
