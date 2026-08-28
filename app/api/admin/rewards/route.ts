import { NextRequest, NextResponse } from 'next/server';
import { listRewards, queueReward, updateReward } from '@/lib/rewardStore';
import { listPlayers } from '@/lib/playerStore';

function authorized(request: NextRequest) {
  const expected = process.env.GEOWEEDO_ADMIN_SECRET;
  return Boolean(expected) && request.headers.get('x-geoweedo-admin') === expected;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ rewards: await listRewards(), players: await listPlayers() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const playerId = String(body?.playerId || '');
  const amount = Number(body?.amountYerb);
  if (!playerId || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'playerId and positive amountYerb are required.' }, { status: 400 });
  const player = (await listPlayers()).find((item) => item.id === playerId && item.rewardEligible && item.walletVerifiedAt);
  if (!player) return NextResponse.json({ error: 'Player is not reward eligible.' }, { status: 400 });
  const reward = await queueReward(playerId, amount, String(body?.reason || 'GeoWeedo reward'), String(body?.reference || '').trim() || undefined);
  return NextResponse.json({ reward }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'Reward id is required.' }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (['pending','held','paid','failed'].includes(body.status)) patch.status = body.status;
  if (body.txid !== undefined) patch.txid = String(body.txid).trim() || undefined;
  if (body.error !== undefined) patch.error = String(body.error).trim() || undefined;
  if (body.status === 'paid') patch.paidAt = new Date().toISOString();
  const reward = await updateReward(String(body.id), patch);
  if (!reward) return NextResponse.json({ error: 'Reward not found.' }, { status: 404 });
  return NextResponse.json({ reward });
}
