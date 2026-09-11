import { NextRequest, NextResponse } from 'next/server';
import { lookupWeedoFacts } from '../../../../lib/weedoFacts';
import { fetchScLabsSample, ingestScLabsSample, isScLabsSampleUrl } from '../../../../lib/scLabs';
import { normalizeScLabsPublicSample } from '../../../../lib/scLabsPublicIdentity';
import { fetchRetailId1A4, isRetailId1A4Url, retailIdFrom1A4Url, type RetailId1A4Record } from '../../../../lib/retailId1a4';
import { ingestRetailId1A4 } from '../../../../lib/retailId1a4Ingest';
import { ingestRetailIdCoaEvidence } from '../../../../lib/retailIdCoaIngestion';
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
    productId: productId || '',
    batchId: null,
    brandName: source.brandName,
    productName: source.productName || source.cultivar || 'Metrc Retail ID product',
    productType: source.productType,
    netContents: source.netContents,
    matchLevel: 'source_backed',
    batchNumber: source.batchNumber,
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
    overallStatus: source.overallStatus,
    cannabinoids,
    terpenes: [],
    safetyTests: [],
    source: {
      type: 'regulatory_public',
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
  return identifier.length >= 3 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(identifier);
}

function normalizeEvidenceRecord(record: any) {
  if (!record) return record;
  if (record.batchId && record.source?.verified && record.source?.type !== 'lab' && record.matchLevel === 'exact_batch') {
    return { ...record, matchLevel: 'source_backed' };
  }
  return record;
}

function isDirectLabRecord(record: any) {
  return Boolean(record?.batchId && record?.source?.verified && record?.source?.type === 'lab');
}

function refreshError(error: unknown) {
  return error instanceof Error ? error.message : 'Retail ID refresh failed.';
}

function canonicalRetailIdUrl(value: string) {
  try {
    const url = new URL(value);
    if (!isRetailId1A4Url(value)) return value;
    // Preserve 1a4.com/<short-token> links so the Retail ID adapter can resolve
    // their real landing page. Only canonicalize URLs that already expose the
    // public /landingpage/<id>/<index> route.
    if (!/^\/landingpage\//i.test(url.pathname)) return url.toString();
    url.protocol = 'https:';
    url.hostname = 'app.1a4.com';
    url.port = '';
    return url.toString();
  } catch {
    return value;
  }
}

function usableRetailIdData(record: RetailId1A4Record) {
  return Boolean(
    record.productName || record.brandName || record.productType || record.netContents ||
    record.batchNumber || record.facility || record.facilityLicense || record.labName ||
    record.labLicense || record.coaDocumentId || record.testedAt || record.analytes.length,
  );
}

async function fetchRetailIdWithRetry(identifier: string) {
  const sourceUrl = canonicalRetailIdUrl(identifier);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const record = await fetchRetailId1A4(sourceUrl);
      if (!usableRetailIdData(record)) {
        throw new Error('Retail ID data API returned no product or lab data.');
      }
      // Preserve the QR/landing URL that was actually scanned as the public
      // source URL even when we canonicalize the API host internally.
      return { ...record, url: identifier };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Retail ID refresh failed.');
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
      const record = normalizeEvidenceRecord(lookupWeedoFacts({ identifier: sample.coaNumber || sample.sampleId, identifierType: 'coa' }));
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
          countScan: false,
        });
      }
      return NextResponse.json({ ok: true, found: Boolean(record), record, resolvedBy: 'sc_labs_public_page', ingestion, persistedQr });
    }

    if (isRetailId1A4Url(identifier)) {
      const pathRetailId = retailIdFrom1A4Url(identifier);
      // Long landing URLs expose the UID directly. Short 1A4 URLs do not, so
      // use the already-persisted QR identifier as the local fallback key.
      const localRecord = normalizeEvidenceRecord(pathRetailId
        ? lookupWeedoFacts({ identifier: pathRetailId, identifierType: 'uid' })
        : lookupWeedoFacts({ identifier, identifierType: 'qr' }));

      let retailId: RetailId1A4Record;
      try {
        // Always refresh a 1A4 QR from its public data API. Retry short-lived
        // upstream failures/empty payloads before using the local GeoWeedo copy.
        retailId = await fetchRetailIdWithRetry(identifier);
      } catch (error) {
        // 1A4 is a source, not the sole owner of data already ingested by
        // GeoWeedo. If this UID/QR is known locally, keep the scan useful while
        // the public source is slow or temporarily unavailable.
        if (localRecord) {
          persistedQr = persistQrScan({
            qrValue: identifier,
            resolver: 'metrc_retail_id',
            productId: localRecord.productId,
            batchId: localRecord.batchId,
            sourceUrl: identifier,
            externalIdentifier: pathRetailId || localRecord.uid,
            title: localRecord.productName,
            brandName: localRecord.brandName,
            productName: localRecord.productName,
            productType: localRecord.productType,
            producerName: localRecord.producerName,
            producerLicenseNumber: localRecord.producerLicenseNumber,
            labName: localRecord.labName,
            labLicenseNumber: localRecord.labLicenseNumber,
            testedAt: localRecord.testedAt,
            coaUrl: localRecord.coaUrl,
            countScan: false,
          });
          return NextResponse.json({
            ok: true,
            found: true,
            record: localRecord,
            resolvedBy: isDirectLabRecord(localRecord)
              ? 'metrc_retail_id_verified_lab_cache'
              : 'metrc_retail_id_cache',
            linkedIdentifier: pathRetailId || localRecord.uid || identifier,
            linkedToGeoWeedo: true,
            refresh: { ok: false, error: refreshError(error) },
            persistedQr,
          });
        }
        throw error;
      }

      if (pathRetailId) retailId.retailId = pathRetailId;

      // Persist or reuse the source-backed Retail ID product/batch identity first.
      const ingestion = ingestRetailId1A4(retailId);
      const productId = localRecord?.productId || ingestion.productId || null;

      // Exact package UID + named lab + structured COA evidence (or reachable
      // original COA URL) promotes/enriches the same UID as a verified lab batch.
      const coaIngestion = await ingestRetailIdCoaEvidence(retailId, productId);

      const linkedRecord = normalizeEvidenceRecord(retailId.retailId
        ? lookupWeedoFacts({ identifier: retailId.retailId, identifierType: 'uid' })
        : null);

      persistedQr = persistRetailId1A4Scan(identifier, retailId, {
        productId: linkedRecord?.productId || coaIngestion.productId || ingestion.productId || null,
        batchId: linkedRecord?.batchId || coaIngestion.batchId || ingestion.batchId || null,
      }, false);

      const record = linkedRecord || retailIdFallbackRecord(retailId, persistedQr.productId);
      return NextResponse.json({
        ok: true,
        found: true,
        record,
        resolvedBy: coaIngestion.verifiedBatch
          ? 'metrc_retail_id_verified_coa'
          : linkedRecord
            ? (ingestion.created ? 'metrc_retail_id_ingested' : 'metrc_retail_id_linked')
            : 'metrc_retail_id_public_page',
        externalRecord: retailId,
        ingestion,
        coaIngestion,
        linkedIdentifier: retailId.retailId,
        linkedToGeoWeedo: Boolean(linkedRecord),
        refresh: { ok: true },
        persistedQr,
      });
    }

    const record = normalizeEvidenceRecord(lookupWeedoFacts({ identifier, identifierType }));
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
        countScan: false,
      });
    }
    return NextResponse.json({ ok: true, found: Boolean(record), record, resolvedBy: identifierType || 'auto', persistedQr });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Weedo Facts scan failed.',
      persistedQr,
    }, { status: 400 });
  }
}
