import HomeClient from '@/components/HomeClient';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { activeSponsorshipMap } from '@/lib/sponsorshipStore';
import type { Dispensary } from '@/data/dispensaries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const sponsorships = await activeSponsorshipMap();
  const initialApprovedDispensaries = (await readApprovedDispensaries())
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
    .sort((a, b) => (b.sponsorPriority ?? 0) - (a.sponsorPriority ?? 0) || a.name.localeCompare(b.name));

  const serializable = JSON.parse(JSON.stringify(initialApprovedDispensaries)) as Dispensary[];
  return <HomeClient initialApprovedDispensaries={serializable} />;
}
