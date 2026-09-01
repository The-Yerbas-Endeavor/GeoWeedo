import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { readApprovedDispensaries, updateDispensaryImagery } from '@/lib/dispensaryStore';
import { lookupGameplayStreetView } from '@/lib/streetViewLookupClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isLegacyFallback(item: { active: boolean; verified: true; imageryProvider: string }) {
  return item.active && item.verified && item.imageryProvider === 'kartaview';
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const all = await readApprovedDispensaries();
  const legacy = all.filter(isLegacyFallback);
  return NextResponse.json({
    totalApproved: all.length,
    legacyKartaview: legacy.length,
    sample: legacy.slice(0, 10).map((item) => ({ id: item.id, name: item.name, city: item.city, region: item.region })),
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(Number(body?.limit) || 10, 25));
  const all = await readApprovedDispensaries();
  const selected = all.filter(isLegacyFallback).slice(0, limit);
  const results: Array<{ id: string; name: string; status: 'upgraded' | 'kept' | 'failed'; message: string }> = [];

  for (const item of selected) {
    try {
      const lookup = await lookupGameplayStreetView(item.latitude, item.longitude);
      const photos = Array.isArray(lookup.photos) ? lookup.photos : [];
      const photo = photos[Math.max(0, Number(lookup.initialIndex || 0))] || photos[0];
      const usableGoogle = lookup.provider === 'google' && Boolean(photo?.id && photo?.imageUrl);

      if (!usableGoogle) {
        results.push({
          id: item.id,
          name: item.name,
          status: 'kept',
          message: 'Google has no usable Street View here; existing fallback imagery was kept.',
        });
        continue;
      }

      await updateDispensaryImagery(item.id, {
        imageryProvider: 'google',
        imageryPhotoId: photo.id,
        imagerySequenceId: photo.sequenceId || photo.id,
        imageryLatitude: Number.isFinite(photo.lat) ? photo.lat : item.latitude,
        imageryLongitude: Number.isFinite(photo.lng) ? photo.lng : item.longitude,
        imageryHeading: photo.heading,
        imageryFieldOfView: photo.fieldOfView ?? 360,
        imageryProjection: photo.projection || 'GOOGLE_PANORAMA',
        imageryUrl: photo.imageUrl,
      });

      results.push({
        id: item.id,
        name: item.name,
        status: 'upgraded',
        message: `Upgraded gameplay Street View from KartaView to Google panorama ${photo.id}.`,
      });
    } catch (error) {
      results.push({
        id: item.id,
        name: item.name,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Street View cleanup failed.',
      });
    }
  }

  const remaining = (await readApprovedDispensaries()).filter(isLegacyFallback).length;
  const upgraded = results.filter((item) => item.status === 'upgraded').length;
  const kept = results.filter((item) => item.status === 'kept').length;
  const failed = results.filter((item) => item.status === 'failed').length;

  return NextResponse.json({
    checked: selected.length,
    upgraded,
    kept,
    failed,
    remaining,
    results,
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
