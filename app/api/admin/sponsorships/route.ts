import { NextRequest, NextResponse } from 'next/server';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { listSponsorships, saveSponsorship } from '@/lib/sponsorshipStore';

function authorized(request: NextRequest) {
  const expected = process.env.GEOWEEDO_ADMIN_SECRET;
  return Boolean(expected) && request.headers.get('x-geoweedo-admin') === expected;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ sponsorships: await listSponsorships(), dispensaries: await readApprovedDispensaries() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const dispensaryId = String(body?.dispensaryId || '');
  const amountYerb = Number(body?.amountYerb);
  const priorityWeight = Number(body?.priorityWeight || 1);
  const startsAt = new Date(body?.startsAt || Date.now());
  const endsAt = new Date(body?.endsAt || Date.now());
  if (!(await readApprovedDispensaries()).some((item) => item.id === dispensaryId)) return NextResponse.json({ error: 'Dispensary not found.' }, { status: 400 });
  if (!Number.isFinite(amountYerb) || amountYerb <= 0) return NextResponse.json({ error: 'Positive amountYerb is required.' }, { status: 400 });
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return NextResponse.json({ error: 'Valid sponsorship dates are required.' }, { status: 400 });
  const sponsorship = await saveSponsorship({
    id: body?.id ? String(body.id) : undefined,
    dispensaryId, amountYerb,
    paymentTxid: String(body?.paymentTxid || '').trim() || undefined,
    priorityWeight: Number.isFinite(priorityWeight) ? priorityWeight : 1,
    status: ['pending','active','expired','cancelled'].includes(body?.status) ? body.status : 'pending',
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
  });
  return NextResponse.json({ sponsorship }, { status: 201 });
}
