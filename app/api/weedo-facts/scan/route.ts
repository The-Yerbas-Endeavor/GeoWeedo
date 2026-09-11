import { NextRequest, NextResponse } from 'next/server';
import { lookupWeedoFacts } from '../../../../lib/weedoFacts';
import { fetchScLabsSample, ingestScLabsSample, isScLabsSampleUrl } from '../../../../lib/scLabs';
import { normalizeScLabsPublicSample } from '../../../../lib/scLabsPublicIdentity';
import { fetchRetailId1A4, isRetailId1A4Url } from '../../../../lib/retailId1a4';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type IdentifierType = 'qr' | 'upc' | 'uid' | 'batch' | 'coa' | 'unknown';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const identifier = String(body?.identifier || '').trim();
  if (!identifier || identifier.length > 512) {
    return NextResponse.json({ ok: false, error: 'A valid identifier is required.' }, { status: 400 });
  }

  try {
    if (isScLabsSampleUrl(identifier)) {
      const sample = normalizeScLabsPublicSample(await fetchScLabsSample(identifier));
      const ingestion = ingestScLabsSample(sample);
      const record = lookupWeedoFacts({ identifier: sample.coaNumber || sample.sampleId, identifierType: 'coa' });
      return NextResponse.json({ ok: true, found: Boolean(record), record, resolvedBy: 'sc_labs_public_page', ingestion });
    }

    if (isRetailId1A4Url(identifier)) {
      const retailId = await fetchRetailId1A4(identifier);
      const record = retailId.retailId
        ? lookupWeedoFacts({ identifier: retailId.retailId, identifierType: 'uid' })
        : null;
      return NextResponse.json({
        ok: true,
        found: Boolean(record),
        record,
        resolvedBy: 'metrc_retail_id',
        externalRecord: retailId,
        linkedIdentifier: retailId.retailId,
      });
    }

    const requestedType = String(body?.type || '').trim().toLowerCase();
    const allowed = ['qr', 'upc', 'uid', 'batch', 'coa', 'unknown'];
    const inferred: IdentifierType | undefined = /^https?:\/\//i.test(identifier) ? 'qr' : /^\d{8,14}$/.test(identifier) ? 'upc' : undefined;
    const identifierType = allowed.includes(requestedType) ? requestedType as IdentifierType : inferred;
    const record = lookupWeedoFacts({ identifier, identifierType });
    return NextResponse.json({ ok: true, found: Boolean(record), record, resolvedBy: identifierType || 'auto' });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Weedo Facts scan failed.' }, { status: 400 });
  }
}
