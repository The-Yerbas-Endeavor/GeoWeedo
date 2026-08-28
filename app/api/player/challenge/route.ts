import { NextRequest, NextResponse } from 'next/server';
import { issueWalletLoginChallenge } from '@/lib/userAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const address = String(body?.address || '').trim();
  if (address.length < 20 || address.length > 80) return NextResponse.json({ error: 'Enter a valid Yerbas address.' }, { status: 400 });
  const challenge = issueWalletLoginChallenge(address);
  return NextResponse.json(challenge);
}
