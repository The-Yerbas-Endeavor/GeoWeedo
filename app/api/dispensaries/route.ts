import { NextResponse } from 'next/server';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { activeSponsorshipMap } from '@/lib/sponsorshipStore';
import {getOrCreateDispensarySlug} from '@/lib/dispensarySlug';
import {getDatabase} from '@/lib/sqlite';

export async function GET() {
  const sponsorships = await activeSponsorshipMap();
  const db=getDatabase();
  const claimed=new Set((db.prepare(`SELECT DISTINCT location_id FROM dispensary_user_owner_assignments WHERE status='verified'`).all() as {location_id:string}[]).map(row=>row.location_id));
  const dispensaries = (await readApprovedDispensaries())
    .filter((item) => item.verified && item.active)
    .map((item) => {
      const sponsorship = sponsorships.get(item.id);
      const isClaimed=claimed.has(item.id);
      return {
        ...item,
        slug:getOrCreateDispensarySlug(item.id),
        claimed:isClaimed,
        sponsored: Boolean(sponsorship),
        sponsorPriority: sponsorship?.priorityWeight ?? 0,
        sponsorshipEndsAt: sponsorship?.endsAt,
        profileTier:sponsorship&&isClaimed?'sponsored_claimed':isClaimed?'claimed_listed':'listed',
      };
    })
    .sort((a, b) => Number(b.sponsored)-Number(a.sponsored) || Number(b.claimed)-Number(a.claimed) || b.sponsorPriority-a.sponsorPriority || a.name.localeCompare(b.name));

  return NextResponse.json({ dispensaries }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
