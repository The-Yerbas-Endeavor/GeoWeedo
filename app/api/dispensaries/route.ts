import { NextResponse } from 'next/server';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { activeSponsorshipMap } from '@/lib/sponsorshipStore';

export async function GET() {
  const sponsorships = await activeSponsorshipMap();
  const dispensaries = (await readApprovedDispensaries())
    .filter((item) => item.verified && item.active)
    .map((item) => {
      const sponsorship = sponsorships.get(item.id);
      return {
        ...item,
        sponsored: Boolean(sponsorship),
        sponsorPriority: sponsorship?.priorityWeight ?? 0,
        sponsorshipEndsAt: sponsorship?.endsAt,
      };
    })
    .sort((a, b) => b.sponsorPriority - a.sponsorPriority || a.name.localeCompare(b.name));

  return NextResponse.json({ dispensaries }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
