import { NextResponse } from 'next/server';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { ensureFinanceSchema } from '@/lib/financeLedger';
import { getDatabase } from '@/lib/sqlite';

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

function publicLocation(item: any, sponsored: boolean, sponsorship?: any) {
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
    sponsored,
    sponsorship: sponsored ? {
      id: sponsorship?.id,
      priorityWeight: Number(sponsorship?.priority_weight || 1),
      endsAt: sponsorship?.ends_at,
    } : undefined,
  };
}

export async function GET() {
  const today = dateKey();
  const now = new Date().toISOString();
  const db = getDatabase();
  ensureFinanceSchema(db);

  const approved = (await readApprovedDispensaries()).filter((item) =>
    item.active && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  if (!approved.length) {
    return NextResponse.json({ error: 'No enabled Daily Weedo locations are available.' }, { status: 503 });
  }

  const approvedById = new Map(approved.map((item) => [item.id, item]));
  const sponsorRows = db.prepare(`
    SELECT id, dispensary_id, priority_weight, starts_at, ends_at
    FROM sponsorships
    WHERE status='active' AND starts_at<=? AND ends_at>=?
    ORDER BY created_at ASC
  `).all(now, now) as any[];

  const eligibleSponsors = sponsorRows
    .map((row) => ({ row, dispensary: approvedById.get(String(row.dispensary_id)) }))
    .filter((entry) => Boolean(entry.dispensary));

  if (eligibleSponsors.length) {
    const totalWeight = eligibleSponsors.reduce((sum, entry) => sum + Math.max(1, Number(entry.row.priority_weight || 1)), 0);
    let cursor = hashString(`geoweedo-daily-sponsor-${today}`) % totalWeight;
    let selected = eligibleSponsors[0];
    for (const entry of eligibleSponsors) {
      const weight = Math.max(1, Number(entry.row.priority_weight || 1));
      if (cursor < weight) { selected = entry; break; }
      cursor -= weight;
    }
    return NextResponse.json({
      date: today,
      source: 'sponsor',
      location: publicLocation(selected.dispensary, true, selected.row),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }

  const target = approved[hashString(`geoweedo-daily-enabled-${today}`) % approved.length];
  return NextResponse.json({
    date: today,
    source: 'enabled',
    location: publicLocation(target, false),
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
