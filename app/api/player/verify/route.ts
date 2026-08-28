import { NextRequest, NextResponse } from 'next/server';
import { consumeWalletChallenge, upsertVerifiedPlayer } from '@/lib/playerStore';
import { verifyYerbasMessage } from '@/lib/yerbasRpc';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const address = String(body?.address || '').trim();
  const signature = String(body?.signature || '').trim();
  const handle = String(body?.handle || '').trim();
  if (!address || !signature) return NextResponse.json({ error: 'Address and signed message are required.' }, { status: 400 });
  const challenge = await consumeWalletChallenge(address);
  if (!challenge) return NextResponse.json({ error: 'Verification challenge expired. Request a new one.' }, { status: 400 });
  try {
    const valid = await verifyYerbasMessage(address, signature, challenge.message);
    if (!valid) return NextResponse.json({ error: 'Wallet signature did not verify.' }, { status: 400 });
    const player = await upsertVerifiedPlayer(handle, address);
    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Wallet verification failed.' }, { status: 502 });
  }
}
