import { NextRequest, NextResponse } from 'next/server';
import { getCachedWeedoProductReconstruction, reconstructWeedoProduct } from '@/lib/weedoFactsReconstruction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeUpc(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

export async function GET(request: NextRequest) {
  const upc = normalizeUpc(request.nextUrl.searchParams.get('upc'));
  if (!/^\d{8,14}$/.test(upc)) {
    return NextResponse.json({ ok: false, error: 'A valid UPC/EAN barcode is required.' }, { status: 400 });
  }
  const reconstruction = getCachedWeedoProductReconstruction(upc);
  return NextResponse.json({ ok: true, found: Boolean(reconstruction), reconstruction });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const upc = normalizeUpc(body?.upc);
  const labelText = String(body?.labelText || '').trim();

  if (!/^\d{8,14}$/.test(upc)) {
    return NextResponse.json({ ok: false, error: 'A valid UPC/EAN barcode is required.' }, { status: 400 });
  }
  if (labelText.length < 8 || labelText.length > 12000) {
    return NextResponse.json({ ok: false, error: 'Recognized label text is required.' }, { status: 400 });
  }

  try {
    const reconstruction = await reconstructWeedoProduct(upc, labelText);
    return NextResponse.json({ ok: true, reconstruction });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Product reconstruction failed.' }, { status: 400 });
  }
}
