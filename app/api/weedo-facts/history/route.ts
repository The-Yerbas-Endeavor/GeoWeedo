import { NextRequest, NextResponse } from 'next/server';
import { getWeedoFactsBatchHistory } from '@/lib/weedoFactsHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const productId = String(request.nextUrl.searchParams.get('productId') || '').trim();
  if (!productId) return NextResponse.json({ error: 'productId is required.' }, { status: 400 });
  const history = getWeedoFactsBatchHistory(productId);
  if (!history) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, ...history }, { headers: { 'Cache-Control': 'no-store' } });
}
