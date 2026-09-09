import { NextRequest, NextResponse } from 'next/server';
import { lookupWeedoFacts } from '../../../../lib/weedoFacts';

export const dynamic = 'force-dynamic';

const allowedTypes = new Set(['qr', 'upc', 'uid', 'batch', 'coa', 'unknown']);

export async function GET(request: NextRequest) {
  const identifier = request.nextUrl.searchParams.get('identifier')?.trim() ?? '';
  const rawType = request.nextUrl.searchParams.get('type')?.trim().toLowerCase() ?? undefined;

  if (!identifier) {
    return NextResponse.json({ ok: false, error: 'identifier is required' }, { status: 400 });
  }

  if (identifier.length > 512) {
    return NextResponse.json({ ok: false, error: 'identifier is too long' }, { status: 400 });
  }

  const identifierType = rawType && allowedTypes.has(rawType)
    ? rawType as 'qr' | 'upc' | 'uid' | 'batch' | 'coa' | 'unknown'
    : undefined;

  const record = lookupWeedoFacts({ identifier, identifierType });
  if (!record) {
    return NextResponse.json({
      ok: true,
      found: false,
      identifier,
      next: 'No verified product or batch is known yet. Future scanner flow can offer QR/COA upload or community submission here.',
    });
  }

  return NextResponse.json({ ok: true, found: true, record });
}
