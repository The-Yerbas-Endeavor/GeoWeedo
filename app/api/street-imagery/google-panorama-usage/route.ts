import { NextResponse } from 'next/server';
import { incrementImageryProviderUsage } from '@/lib/imageryProviderSettings';

export const runtime = 'nodejs';

export async function POST() {
  incrementImageryProviderUsage('google', 'panorama');
  return NextResponse.json({ ok: true });
}
