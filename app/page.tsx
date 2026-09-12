import HomeClient from '@/components/HomeClient';
import MapScannerSearchPlacement from '@/components/MapScannerSearchPlacement';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import type { Dispensary } from '@/data/dispensaries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const approved = await readApprovedDispensaries();
  const initialApprovedDispensaries = approved
    .filter((item) => item.verified && item.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  const serializable = JSON.parse(JSON.stringify(initialApprovedDispensaries)) as Dispensary[];
  return <><HomeClient initialApprovedDispensaries={serializable} /><MapScannerSearchPlacement /></>;
}
