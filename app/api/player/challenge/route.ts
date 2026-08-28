import { NextRequest, NextResponse } from 'next/server';
import { issueWalletChallenge } from '@/lib/playerStore';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const address = String(body?.address || '').trim();
  if (address.length < 20 || address.length > 80) return NextResponse.json({ error: 'Enter a valid Yerbas address.' }, { status: 400 });
  const challenge = await issueWalletChallenge(address);
  return NextResponse.json({ message: challenge.message, expiresAt: challenge.expiresAt });
}
