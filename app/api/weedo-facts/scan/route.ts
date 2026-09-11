import { NextRequest, NextResponse } from 'next/server';
import { lookupWeedoFacts } from '../../../../lib/weedoFacts';
import { fetchScLabsSample, ingestScLabsSample, isScLabsSampleUrl } from '../../../../lib/scLabs';
import { normalizeScLabsPublicSample } from '../../../../lib/scLabsPublicIdentity';
import { fetchRetailId1A4, isRetailId1A4Url, type RetailId1A4Record } from '../../../../lib/retailId1a4';
import { persistQrScan, persistRetailId1A4Scan } from '../../../../lib/weedoFactsQrPersistence';

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

function retailIdFallbackRecord(source: RetailId1A4Record, productId?: string | null) {
  const cannabinoids = [potency(source.thcText, 'THC'), potency(source.cbdText, 'CBD')].filter(Boolean);
  return {
    productId: productId || `retail-id:${source.retailId || source.serial || 'unknown'}`,
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

function requestedIdentifierType(body: any, identifier: string): IdentifierType | undefined {
  const requestedType = String(body?.type || '').trim().toLowerCase();
  const allowed: IdentifierType[] = ['qr', 'upc', 'uid', 'batch', 'coa', 'unknown'];
  if (allowed.includes(requestedType as IdentifierType)) return requestedType as IdentifierType;
  if (/^https?:\/\//i.test(identifier)) return 'qr';
  if (/^\d{8,14}$/.test(identifier)) return 'upc';
  return undefined;
}

function validQrPayload(identifier: string) {
  if (!identifier || identifier.length > 512) return false;
  if (/^https?:\/\//i.test(identifier)) {
    try {
      const url = new URL(identifier);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch { return false; }
  }
  // QR codes may contain regulatory IDs or compact text rather than URLs.
  // Reject control-character payloads while keeping ordinary decoded QR data.
  return identifier.length >= 3 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(identifier);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const identifier = String(body?.identifier || '').trim();
  if (!identifier || identifier.length > 512) {
    return NextResponse.json({ ok: false, error: 'A valid identifier is required.' }, { status: 400 });
  }

  const identifierType = requestedIdentifierType(body, identifier);
  const isQr = identifierType === 'qr';
  let persistedQr: ReturnType<typeof persistQrScan> | null = null;

  try {
    // A successfully decoded QR should never be ephemeral. Save the raw payload
    // first, then enrich the same record as external/local resolution succeeds.
    if (isQr && validQrPayload(identifier)) {
      persistedQr = persistQrScan({
        qrValue: identifier,
        resolver: isScLabsSampleUrl(identifier)
          ? 'sc_labs_public_page'
          : isRetailId1A4Url(identifier)
            ? 'metrc_retail_id'
            : 'generic_qr',
        sourceUrl: /^https?:\/\//i.test(identifier) ? identifier : null,
      });
    }

    if (isScLabsSampleUrl(identifier)) {
      const sample = normalizeScLabsPublicSample(await fetchScLabsSample(identifier));
      const ingestion = ingestScLabsSample(sample);
      const record = lookupWeedoFacts({ identifier: sample.coaNumber || sample.sampleId, identifierType: 'coa' });
      if (isQr) {
        persistedQr = persistQrScan({
          qrValue: identifier,
          resolver: 'sc_labs_public_page',
          productId: record?.productId || null,
          batchId: record?.batchId || null,
          sourceUrl: identifier,
          externalIdentifier: sample.coaNumber || sample.sampleId || null,
          title: record?.productName || null,
          brandName: record?.brandName || null,
          productName: record?.productName || null,
          productType: record?.productType || null,
          producerName: record?.producerName || null,
          producerLicenseNumber: record?.producerLicenseNumber || null,
          labName: record?.labName || null,
          labLicenseNumber: record?.labLicenseNumber || null,
          testedAt: record?.testedAt || null,
          coaUrl: record?.coaUrl || identifier,
          resolvedPayload: sample,
        });
      }
      return NextResponse.json({ ok: true, found: Boolean(record), record, resolvedBy: 'sc_labs_public_page', ingestion, persistedQr });
    }

    if (isRetailId1A4Url(identifier)) {
      const retailId = await fetchRetailId1A4(identifier);
      const linkedRecord = retailId.retailId
        ? lookupWeedoFacts({ identifier: retailId.retailId, identifierType: 'uid' })
        : null;
      persistedQr = persistRetailId1A4Scan(identifier, retailId, {
        productId: linkedRecord?.productId || null,
        batchId: linkedRecord?.batchId || null,
      });
      const record = linkedRecord || retailIdFallbackRecord(retailId, persistedQr.productId);
      return NextResponse.json({
        ok: true,
        found: true,
        record,
        resolvedBy: linkedRecord ? 'metrc_retail_id_linked' : 'metrc_retail_id_public_page',
        externalRecord: retailId,
        linkedIdentifier: retailId.retailId,
        linkedToGeoWeedo: Boolean(linkedRecord),
        persistedQr,
      });
    }

    const record = lookupWeedoFacts({ identifier, identifierType });
    if (isQr && persistedQr) {
      persistedQr = persistQrScan({
        qrValue: identifier,
        resolver: record ? 'local_weedo_facts' : 'generic_qr',
        productId: record?.productId || null,
        batchId: record?.batchId || null,
        sourceUrl: /^https?:\/\//i.test(identifier) ? identifier : null,
        externalIdentifier: identifier,
        title: record?.productName || null,
        brandName: record?.brandName || null,
        productName: record?.productName || null,
        productType: record?.productType || null,
        producerName: record?.producerName || null,
        producerLicenseNumber: record?.producerLicenseNumber || null,
        labName: record?.labName || null,
        labLicenseNumber: record?.labLicenseNumber || null,
        testedAt: record?.testedAt || null,
        coaUrl: record?.coaUrl || null,
      });
    }
    return NextResponse.json({ ok: true, found: Boolean(record), record, resolvedBy: identifierType || 'auto', persistedQr });
  } catch (error) {
    // If the QR itself was valid and decoded, its raw value was already saved.
    // Resolver failures should not discard the scan.
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Weedo Facts scan failed.',
      persistedQr,
    }, { status: 400 });
  }
}
