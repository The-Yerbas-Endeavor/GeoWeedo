import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/userAuth';
import { getCommunityProfile, getLocationBase, upsertCommunityProfile, userOwnerCanEdit } from '@/lib/dispensaryCommunity';

type Context = { params: Promise<{ id: string }> };
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: Context) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Login required.' }, { status: 401 });
  const { id } = await params;
  if (!userOwnerCanEdit(user.id, id)) return NextResponse.json({ error: 'This shop is not assigned to your account.' }, { status: 403 });
  const location = getLocationBase(id);
  if (!location) return NextResponse.json({ error: 'Location not found.' }, { status: 404 });
  return NextResponse.json({
    location,
    profile: getCommunityProfile(id) || { locationId: id, hours: {}, amenities: [], social: {} },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest, { params }: Context) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Login required.' }, { status: 401 });
  const { id } = await params;
  if (!userOwnerCanEdit(user.id, id)) return NextResponse.json({ error: 'This shop is not assigned to your account.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid profile payload.' }, { status: 400 });
  try {
    const profile = upsertCommunityProfile(id, {
      overview: String(body.overview || ''),
      phone: String(body.phone || ''),
      website: String(body.website || ''),
      hours: body.hours && typeof body.hours === 'object' ? body.hours : {},
      amenities: Array.isArray(body.amenities) ? body.amenities.map(String) : [],
      social: body.social && typeof body.social === 'object' ? body.social : {},
    }, { type: 'owner', id: user.id });
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Profile update failed.' }, { status: 400 });
  }
}
