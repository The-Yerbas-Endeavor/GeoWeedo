import { NextResponse } from 'next/server';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function hashString(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function publicLocation(item: any) {
  return {
    id: item.id,
    name: item.name,
    latitude: Number(item.latitude),
    longitude: Number(item.longitude),
    city: item.city || '',
    region: item.region || '',
    country: item.country || 'USA',
    website: item.website || undefined,
    dataSource: item.dataSource || undefined,
    sponsored: Boolean(item.sponsored),
  };
}

export async function GET() {
  const today = dateKey();
  const approved = (await readApprovedDispensaries()).filter((item) =>
    item.active && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));

  if (!approved.length) {
    return NextResponse.json({ error: 'No enabled Daily Weedo locations are available.' }, { status: 503 });
  }

  // Daily Weedo remains a fair, deterministic daily challenge. Featured status is
  // presentation/analytics only and never changes a location's selection odds.
  const target = approved[hashString(`geoweedo-daily-enabled-${today}`) % approved.length];

  return NextResponse.json({
    date: today,
    source: 'enabled',
    location: publicLocation(target),
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
