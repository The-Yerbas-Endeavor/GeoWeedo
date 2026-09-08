import { NextRequest, NextResponse } from 'next/server';
import { adminHasPermission, getAdminFromRequest } from '@/lib/adminAuth';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { ensureSponsorshipSchema, grantFeatured, listFeaturedEntitlements } from '@/lib/sponsorshipStore';
import { grantGameCampaign, listGameCampaigns, updateGameCampaignStatus, type CampaignGeographyType, type GameCampaignStatus, type GameCampaignType } from '@/lib/gameSponsorship';
import { getDatabase } from '@/lib/sqlite';

export const runtime = 'nodejs';

function requireSponsorAdmin(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return { error: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }) };
  if (!adminHasPermission(admin, 'sponsorships.manage')) return { error: NextResponse.json({ error: 'You do not have permission to manage sponsorships.' }, { status: 403 }) };
  return { admin };
}

export async function GET(request: NextRequest) {
  const auth = requireSponsorAdmin(request);
  if ('error' in auth) return auth.error;
  ensureSponsorshipSchema();
  return NextResponse.json({
    plan: { code: 'featured', name: 'GeoWeedo Featured', currency: 'USD', monthlyPriceCents: 3900, annualPriceCents: 39000 },
    gameProducts: {
      classic: { name: 'Classic Sponsor', dayPriceCents: 1000, weekPriceCents: 4900, monthPriceCents: 14900 },
      daily: { name: 'Daily Weedo Sponsor', dayPriceCents: 1500, weekPriceCents: 7900, monthPriceCents: 24900 },
      hunt: { name: 'Sponsored Weedo Hunt', weekPriceCents: 9900, monthPriceCents: 29900 },
    },
    entitlements: listFeaturedEntitlements(),
    campaigns: listGameCampaigns(),
    dispensaries: await readApprovedDispensaries(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const auth = requireSponsorAdmin(request);
  if ('error' in auth) return auth.error;
  const admin = auth.admin;
  const body = await request.json().catch(() => null);
  const dispensaryId = String(body?.dispensaryId || '');
  const approved = await readApprovedDispensaries();
  if (!approved.some((item) => item.id === dispensaryId)) return NextResponse.json({ error: 'Dispensary not found.' }, { status: 400 });

  if (body?.kind === 'campaign') {
    const gameType = String(body?.gameType || '') as GameCampaignType;
    const geographyType = String(body?.geographyType || 'all') as CampaignGeographyType;
    const campaignStatus = body?.status === 'paused' ? 'paused' : body?.status === 'expired' ? 'expired' : body?.status === 'cancelled' ? 'cancelled' : 'active';
    const source = body?.source === 'manual_invoice' ? 'manual_invoice' : body?.source === 'subscription' ? 'subscription' : 'admin_comp';
    if (!['classic','daily','hunt'].includes(gameType)) return NextResponse.json({ error: 'Choose Classic, Daily Weedo, or Weedo Hunt.' }, { status: 400 });
    if (!['all','country','region','city','radius'].includes(geographyType)) return NextResponse.json({ error: 'Choose a valid campaign geography.' }, { status: 400 });
    try {
      const campaign = grantGameCampaign({
        dispensaryId,
        gameType,
        startsAt: String(body?.startsAt || ''),
        endsAt: String(body?.endsAt || ''),
        placement: 'presented_by',
        geographyType,
        geographyValue: body?.geographyValue ? String(body.geographyValue) : null,
        radiusKm: body?.radiusKm === '' || body?.radiusKm == null ? null : Number(body.radiusKm),
        status: campaignStatus as GameCampaignStatus,
        source,
        amountCents: body?.amountCents === '' || body?.amountCents == null ? null : Number(body.amountCents),
        title: body?.title ? String(body.title) : null,
        grantedByAdminId: admin.id,
      });
      return NextResponse.json({ campaign }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save game campaign.' }, { status: 400 });
    }
  }

  const startsAt = new Date(body?.startsAt || Date.now());
  const endsAt = new Date(body?.endsAt || Date.now());
  const status = body?.status === 'expired' ? 'expired' : body?.status === 'cancelled' ? 'cancelled' : 'active';
  const source = body?.source === 'manual_invoice' ? 'manual_invoice' : body?.source === 'subscription' ? 'subscription' : 'admin_comp';
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

export async function PATCH(request: NextRequest) {
  const auth = requireSponsorAdmin(request);
  if ('error' in auth) return auth.error;
  const body = await request.json().catch(() => null);
  const kind = String(body?.kind || '');
  const id = String(body?.id || '');
  if (!id) return NextResponse.json({ error: 'Sponsorship id is required.' }, { status: 400 });

  try {
    if (kind === 'campaign') {
      if (body?.action !== 'edit') {
        const campaign = updateGameCampaignStatus(id, 'cancelled');
        return NextResponse.json({ campaign }, { status: 200 });
      }

      const gameType = String(body?.gameType || '') as GameCampaignType;
      const geographyType = String(body?.geographyType || 'all') as CampaignGeographyType;
      const campaignStatus = body?.status === 'paused' ? 'paused' : body?.status === 'expired' ? 'expired' : body?.status === 'cancelled' ? 'cancelled' : 'active';
      const source = body?.source === 'manual_invoice' ? 'manual_invoice' : body?.source === 'subscription' ? 'subscription' : 'admin_comp';
      if (!['classic','daily','hunt'].includes(gameType)) return NextResponse.json({ error: 'Choose Classic, Daily Weedo, or Weedo Hunt.' }, { status: 400 });
      if (!['all','country','region','city','radius'].includes(geographyType)) return NextResponse.json({ error: 'Choose a valid campaign geography.' }, { status: 400 });

      const startsAt = new Date(String(body?.startsAt || ''));
      const endsAt = new Date(String(body?.endsAt || ''));
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) return NextResponse.json({ error: 'Campaign end must be after its start.' }, { status: 400 });
      const radiusValue = body?.radiusKm === '' || body?.radiusKm == null ? null : Number(body.radiusKm);
      if (geographyType === 'radius' && (!Number.isFinite(radiusValue as number) || Number(radiusValue) <= 0)) return NextResponse.json({ error: 'Radius campaigns require a positive radius.' }, { status: 400 });
      const amountCents = body?.amountCents === '' || body?.amountCents == null ? null : Number(body.amountCents);
      if (amountCents != null && (!Number.isFinite(amountCents) || amountCents < 0)) return NextResponse.json({ error: 'Amount must be zero or greater.' }, { status: 400 });

      const db = getDatabase();
      const existing = db.prepare(`SELECT id FROM sponsor_game_campaigns WHERE id=? LIMIT 1`).get(id) as {id:string}|undefined;
      if (!existing) return NextResponse.json({ error: 'Game sponsorship not found.' }, { status: 404 });
      if (gameType === 'daily' && campaignStatus === 'active') {
        const overlap = db.prepare(`SELECT id FROM sponsor_game_campaigns WHERE id<>? AND game_type='daily' AND status='active' AND starts_at<? AND ends_at>? LIMIT 1`).get(id, endsAt.toISOString(), startsAt.toISOString()) as {id:string}|undefined;
        if (overlap) return NextResponse.json({ error: 'Daily Weedo already has another active sponsor during this period.' }, { status: 400 });
      }
      const now = new Date().toISOString();
      db.prepare(`UPDATE sponsor_game_campaigns SET game_type=?,placement='presented_by',geography_type=?,geography_value=?,radius_km=?,starts_at=?,ends_at=?,status=?,source=?,amount_cents=?,title=?,updated_at=? WHERE id=?`).run(
        gameType,
        geographyType,
        geographyType === 'all' || geographyType === 'radius' ? null : (body?.geographyValue ? String(body.geographyValue).trim() || null : null),
        geographyType === 'radius' ? radiusValue : null,
        startsAt.toISOString(),
        endsAt.toISOString(),
        campaignStatus,
        source,
        amountCents,
        body?.title ? String(body.title).trim() || null : null,
        now,
        id,
      );
      const campaign = listGameCampaigns().find((item) => item.id === id) || null;
      return NextResponse.json({ campaign }, { status: 200 });
    }
    if (kind === 'featured') {
      ensureSponsorshipSchema();
      const db = getDatabase();
      const existing = db.prepare(`SELECT id FROM sponsor_entitlements WHERE id=? AND entitlement_type='featured_listing' LIMIT 1`).get(id) as {id:string}|undefined;
      if (!existing) return NextResponse.json({ error: 'Featured sponsorship not found.' }, { status: 404 });
      const now = new Date().toISOString();
      db.prepare(`UPDATE sponsor_entitlements SET status='cancelled', ends_at=?, updated_at=? WHERE id=?`).run(now, now, id);
      return NextResponse.json({ entitlement: listFeaturedEntitlements().find((item) => item.id === id) || null }, { status: 200 });
    }
    return NextResponse.json({ error: 'Choose a Featured or game sponsorship.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update sponsorship.' }, { status: 400 });
  }
}
