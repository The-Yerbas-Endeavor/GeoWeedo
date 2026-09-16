import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { ingestCanonicalMenuListing, type CanonicalMenuListingInput } from '@/lib/weedoCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Partial<CanonicalMenuListingInput> | null;
  const dispensaryId = String(body?.dispensaryId || '').trim();
  const externalProductName = String(body?.externalProductName || '').trim();
  if (!dispensaryId || !externalProductName) {
    return NextResponse.json({ error: 'dispensaryId and externalProductName are required.' }, { status: 400 });
  }

  try {
    const result = ingestCanonicalMenuListing({
      dispensaryId,
      externalProductName,
      brand: body?.brand ?? null,
      category: body?.category ?? null,
      size: body?.size ?? null,
      priceCents: body?.priceCents ?? null,
      currency: body?.currency ?? 'USD',
      url: body?.url ?? null,
      availability: body?.availability ?? 'unknown',
      observedAt: body?.observedAt ?? new Date().toISOString(),
      sourceType: body?.sourceType ?? 'import',
      externalItemId: body?.externalItemId ?? null,
      imageUrl: body?.imageUrl ?? null,
      identifiers: Array.isArray(body?.identifiers) ? body.identifiers : [],
      batchNumber: body?.batchNumber ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to ingest menu listing.' }, { status: 400 });
  }
}
