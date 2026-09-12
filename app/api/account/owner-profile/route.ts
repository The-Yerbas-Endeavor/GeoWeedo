import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/userAuth';
import { listUserOwnedLocations } from '@/lib/dispensaryCommunity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Login required.' }, { status: 401 });

  const locations = listUserOwnedLocations(user.id).map(row => ({
    location_id: row.locationId,
    verified_at: row.verifiedAt,
    name: row.location?.name || 'Verified dispensary',
    city: row.location?.city || '',
    region: row.location?.region || '',
    kind: row.location?.kind || 'dispensary',
    active: Boolean(row.location?.active),
    public_verified: Boolean(row.location?.verified),
    menu_ready: row.location?.kind === 'dispensary' ? 1 : 0,
  }));

  return NextResponse.json({ locations }, { headers: { 'Cache-Control': 'no-store' } });
}
