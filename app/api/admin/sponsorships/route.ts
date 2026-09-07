import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { ensureSponsorshipSchema, grantFeatured, listFeaturedEntitlements } from '@/lib/sponsorshipStore';
import { getDatabase } from '@/lib/sqlite';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin || admin.role !== 'admin') return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  ensureSponsorshipSchema();
  return NextResponse.json({
    plan: { code: 'featured', name: 'GeoWeedo Featured', currency: 'USD', monthlyPriceCents: 3900, annualPriceCents: 39000 },
    entitlements: listFeaturedEntitlements(),
    dispensaries: await readApprovedDispensaries(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin || admin.role !== 'admin') return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const dispensaryId = String(body?.dispensaryId || '');
  const startsAt = new Date(body?.startsAt || Date.now());
  const endsAt = new Date(body?.endsAt || Date.now());
  const status = body?.status === 'expired' ? 'expired' : body?.status === 'cancelled' ? 'cancelled' : 'active';
  const source = body?.source === 'manual_invoice' ? 'manual_invoice' : body?.source === 'subscription' ? 'subscription' : 'admin_comp';

  if (!(await readApprovedDispensaries()).some((item) => item.id === dispensaryId)) return NextResponse.json({ error: 'Dispensary not found.' }, { status: 400 });
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) return NextResponse.json({ error: 'Valid Featured dates are required.' }, { status: 400 });

  const verifiedOwner = getDatabase().prepare(`SELECT user_id FROM dispensary_user_owner_assignments WHERE location_id=? AND status='verified' ORDER BY verified_at DESC LIMIT 1`).get(dispensaryId) as {user_id:string}|undefined;

  try {
    const entitlement = grantFeatured({
      dispensaryId,
      businessId: body?.businessId ? String(body.businessId) : undefined,
      ownerUserId: body?.ownerUserId ? String(body.ownerUserId) : verifiedOwner?.user_id,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      status,
      source,
      adminId: admin.id,
    });
    return NextResponse.json({ entitlement }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save Featured entitlement.' }, { status: 400 });
  }
}
