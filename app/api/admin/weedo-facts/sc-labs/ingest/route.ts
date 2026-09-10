import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { fetchScLabsSample, ingestScLabsSample } from '@/lib/scLabs';
import { normalizeScLabsPublicSample } from '@/lib/scLabsPublicIdentity';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const sourceUrl = String(body?.sourceUrl || '').trim();
  if (!sourceUrl) return NextResponse.json({ error: 'sourceUrl is required.' }, { status: 400 });
  try {
    const sample = normalizeScLabsPublicSample(await fetchScLabsSample(sourceUrl));
    const result = ingestScLabsSample(sample);
    return NextResponse.json({ ok: true, result, sample: {
      sampleId: sample.sampleId,
      productName: sample.productName,
      brandName: sample.brandName || null,
      productType: sample.productType || null,
      batchNumber: sample.batchNumber || null,
      uid: sample.uid || null,
      coaNumber: sample.coaNumber || null,
      testedAt: sample.testedAt || null,
      overallStatus: sample.overallStatus || null,
      producerName: sample.producerName || null,
      producerLicenseNumber: sample.producerLicenseNumber || null,
      analyteCount: sample.analytes.length,
      sourceUrl: sample.sourceUrl,
    }});
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'SC Labs ingestion failed.' }, { status: 400 });
  }
}
