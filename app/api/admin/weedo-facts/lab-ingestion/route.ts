import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getLabProvider, listLabProviders } from '@/lib/labProviders';
import { recentLabIngestionRuns, runLabIngestion } from '@/lib/labIngestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const provider = String(request.nextUrl.searchParams.get('provider') || '').trim() || undefined;
  return NextResponse.json({ providers: listLabProviders(), runs: recentLabIngestionRuns(provider, 25) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const providerId = String(body?.provider || 'sc-labs').trim();
  const provider = getLabProvider(providerId);
  if (!provider) return NextResponse.json({ error: 'Unknown lab provider.' }, { status: 400 });
  const maxItems = Math.max(1, Math.min(Number(body?.maxItems) || 100, 500));
  const refreshHours = Math.max(0, Math.min(Number(body?.refreshHours) || 24, 24 * 30));
  try {
    const summary = await runLabIngestion(provider, { triggerType: 'admin', maxItems, refreshHours });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Lab ingestion failed.' }, { status: 500 });
  }
}
