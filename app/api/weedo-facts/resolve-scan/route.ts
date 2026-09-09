import { NextRequest, NextResponse } from 'next/server';
import { lookupWeedoFacts } from '@/lib/weedoFacts';
import { fetchScLabsSample, ingestScLabsSample, isScLabsSampleUrl } from '@/lib/scLabs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type IdentifierType = 'qr' | 'upc' | 'uid' | 'batch' | 'coa' | 'unknown';

function inferIdentifierType(value: string): IdentifierType {
  if (/^https?:\/\//i.test(value)) return 'qr';
  if (/^\d{8,14}$/.test(value.replace(/[\s-]/g, ''))) return 'upc';
  return 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const value = typeof body?.value === 'string' ? body.value.trim() : '';
    if (!value) return NextResponse.json({ error: 'A scan value is required.' }, { status: 400 });
    if (value.length > 2048) return NextResponse.json({ error: 'Scan value is too long.' }, { status: 400 });

    const requestedType = ['qr', 'upc', 'uid', 'batch', 'coa', 'unknown'].includes(body?.type)
      ? body.type as IdentifierType
      : inferIdentifierType(value);

    // Only known SC Labs public sample URLs are ever fetched server-side. This keeps
    // the public scanner from becoming a general-purpose URL fetch endpoint.
    if (requestedType === 'qr' && isScLabsSampleUrl(value)) {
      const sample = await fetchScLabsSample(value);
      ingestScLabsSample(sample);
      const record = lookupWeedoFacts({ identifier: value, identifierType: 'qr' })
        ?? lookupWeedoFacts({ identifier: sample.sampleId, identifierType: 'coa' });
      return NextResponse.json({ ok: true, found: Boolean(record), identifierType: 'qr', ingested: true, record });
    }

    const normalizedValue = requestedType === 'upc' ? value.replace(/[\s-]/g, '') : value;
    const record = lookupWeedoFacts({ identifier: normalizedValue, identifierType: requestedType });
    return NextResponse.json({
      ok: true,
      found: Boolean(record),
      identifierType: requestedType,
      ingested: false,
      record,
    });
  } catch (error) {
    console.error('[weedo-facts/resolve-scan]', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to resolve this scan right now.',
    }, { status: 400 });
  }
}
