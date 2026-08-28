import { NextRequest, NextResponse } from 'next/server';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { listSponsorships, saveSponsorship, type Sponsorship } from '@/lib/sponsorshipStore';

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
  const paymentTxid = String(body?.paymentTxid || '').trim() || undefined;
  const startsAt = new Date(body?.startsAt || Date.now());
  const endsAt = new Date(body?.endsAt || Date.now());
  if (!(await readApprovedDispensaries()).some((item) => item.id === dispensaryId)) return NextResponse.json({ error: 'Dispensary not found.' }, { status: 400 });
  if (!Number.isFinite(amountYerb) || amountYerb <= 0) return NextResponse.json({ error: 'Positive amountYerb is required.' }, { status: 400 });
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) return NextResponse.json({ error: 'Valid sponsorship dates are required.' }, { status: 400 });
  const rawStatus = String(body?.status || 'pending');
  const status: Sponsorship['status'] = (['pending','active','expired','cancelled'] as const).includes(rawStatus as Sponsorship['status']) ? rawStatus as Sponsorship['status'] : 'pending';
  if (status === 'active' && !paymentTxid) return NextResponse.json({ error: 'A YERB payment transaction ID is required before activating a sponsorship.' }, { status: 400 });
  const sponsorship = await saveSponsorship({
    id: body?.id ? String(body.id) : undefined,
    dispensaryId, amountYerb, paymentTxid,
    priorityWeight: Number.isFinite(priorityWeight) ? priorityWeight : 1,
    status,
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
  });
  return NextResponse.json({ sponsorship }, { status: 201 });
}
