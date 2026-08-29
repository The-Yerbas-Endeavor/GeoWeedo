import { NextRequest, NextResponse } from 'next/server';
import { verifyYerbasMessage } from '@/lib/yerbasRpc';
import { consumeWalletLoginChallenge, createOrLoginUser, USER_COOKIE } from '@/lib/userAuth';
import { resolveRequestGeo } from '@/lib/requestGeo';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const address = String(body?.address || '').trim();
  const signature = String(body?.signature || '').trim();
  const handle = String(body?.handle || '').trim();
  if (!address || !signature) return NextResponse.json({ error: 'Address and signed message are required.' }, { status: 400 });

  const challenge = consumeWalletLoginChallenge(address);
  if (!challenge) return NextResponse.json({ error: 'Verification challenge expired. Request a new one.' }, { status: 400 });

  try {
    const valid = await verifyYerbasMessage(address, signature, challenge);
    if (!valid) return NextResponse.json({ error: 'Wallet signature did not verify.' }, { status: 400 });
    const geo = await resolveRequestGeo(request);
    const login = createOrLoginUser(handle, address, request.headers.get('user-agent'), geo);
    const response = NextResponse.json({ player: login.user });
    response.cookies.set(USER_COOKIE, login.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: login.expires,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Wallet verification failed.' }, { status: 502 });
  }
}
