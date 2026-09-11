import { NextRequest, NextResponse } from 'next/server';
import { lookupWeedoFacts } from '../../../../lib/weedoFacts';
import { fetchScLabsSample, ingestScLabsSample, isScLabsSampleUrl } from '../../../../lib/scLabs';
import { normalizeScLabsPublicSample } from '../../../../lib/scLabsPublicIdentity';
import { fetchRetailId1A4, isRetailId1A4Url, type RetailId1A4Record } from '../../../../lib/retailId1a4';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type IdentifierType = 'qr' | 'upc' | 'uid' | 'batch' | 'coa' | 'unknown';

function potency(value: string | null, label: string) {
  if (!value) return null;
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*(%|MG|G|UG|MCG)?(?:\s+PER\s+(PACKAGE|SERVING|UNIT))?/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const rawUnit = String(match[2] || '').toLowerCase();
  const per = String(match[3] || '').toLowerCase();
  const unit = rawUnit ? `${rawUnit}${per ? `/${per}` : ''}` : null;
  return { name: label, value: number, unit };
}

function retailIdFallbackRecord(source: RetailId1A4Record) {
  const cannabinoids = [potency(source.thcText, 'THC'), potency(source.cbdText, 'CBD')].filter(Boolean);
  return {
    productId: `retail-id:${source.retailId || source.serial || 'unknown'}`,
    batchId: null,
    brandName: null,
    productName: source.title || source.cultivar || 'Metrc Retail ID product',
    productType: null,
    netContents: null,
    matchLevel: 'product_only',
    batchNumber: null,
    uid: source.retailId,
    coaNumber: null,
    coaUrl: source.coaUrl,
    labName: source.labName,
    labLicenseNumber: source.labLicense,
    producerName: source.facility,
    producerLicenseNumber: source.facilityLicense,
    testedAt: source.testedAt,
    collectedAt: null,
    receivedAt: null,
    overallStatus: null,
    cannabinoids,
    terpenes: [],
    safetyTests: [],
    source: {
      type: 'regulatory_retail_id',
      name: 'Metrc Retail ID',
      url: source.url,
      verified: true,
    },
  };
}

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
      const linkedRecord = retailId.retailId
        ? lookupWeedoFacts({ identifier: retailId.retailId, identifierType: 'uid' })
        : null;
      const record = linkedRecord || retailIdFallbackRecord(retailId);
      return NextResponse.json({
        ok: true,
        found: true,
        record,
        resolvedBy: linkedRecord ? 'metrc_retail_id_linked' : 'metrc_retail_id_public_page',
        externalRecord: retailId,
        linkedIdentifier: retailId.retailId,
        linkedToGeoWeedo: Boolean(linkedRecord),
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
