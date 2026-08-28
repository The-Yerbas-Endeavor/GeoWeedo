import { NextResponse } from 'next/server';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';

export async function GET() {
  const dispensaries = (await readApprovedDispensaries()).filter((item) => item.verified && item.active);
  return NextResponse.json({ dispensaries }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
