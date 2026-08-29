import { NextResponse } from 'next/server';
import { getGameRewardPolicy } from '@/lib/gameRewardPolicy';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(getGameRewardPolicy(), { headers: { 'Cache-Control': 'no-store' } });
}
