import { NextRequest, NextResponse } from 'next/server';
import { recordSponsorEvent, type SponsorEventType } from '@/lib/sponsorshipStore';

export const runtime = 'nodejs';

const ALLOWED = new Set<SponsorEventType>([
  'pin_impression',
  'pin_click',
  'listing_view',
  'website_click',
  'menu_click',
  'directions_click',
  'game_impression',
  'game_completed',
]);

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const dispensaryId = String(body?.dispensaryId || '').trim();
  const eventType = String(body?.eventType || '') as SponsorEventType;
  if (!dispensaryId || !ALLOWED.has(eventType)) {
    return NextResponse.json({ error: 'A valid dispensaryId and eventType are required.' }, { status: 400 });
  }

  const rawMetadata = body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : undefined;
  const metadata = rawMetadata ? Object.fromEntries(Object.entries(rawMetadata).slice(0, 12).map(([key, value]) => [String(key).slice(0, 80), String(value).slice(0, 500)])) : undefined;
  const recorded = recordSponsorEvent(dispensaryId, eventType, metadata);
  return NextResponse.json({ ok: true, recorded });
}
