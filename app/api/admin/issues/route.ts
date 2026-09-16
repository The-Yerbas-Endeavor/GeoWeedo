import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getAdminIssuesDashboard, resolveAdminIssueEvent } from '@/lib/adminIssues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const requestedHours = Number(request.nextUrl.searchParams.get('staleHours') || 24);
  const staleHours = Number.isFinite(requestedHours) ? Math.max(1, Math.min(168, Math.floor(requestedHours))) : 24;
  return NextResponse.json(getAdminIssuesDashboard(staleHours), { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const eventId = String(body?.eventId || '').trim();
  if (!eventId) return NextResponse.json({ error: 'eventId is required.' }, { status: 400 });
  const resolved = resolveAdminIssueEvent(eventId);
  if (!resolved) return NextResponse.json({ error: 'Open issue event was not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, eventId, resolved: true });
}
