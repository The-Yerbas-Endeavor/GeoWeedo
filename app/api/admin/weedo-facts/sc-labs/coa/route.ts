import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { parseScLabsCoaPdf } from '@/lib/scLabsCoaPdf';
import { enrichScLabsBatchFromCoa } from '@/lib/weedoFactsCoa';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  try {
    const form = await request.formData();
    const upload = form.get('file');
    const expectedSampleId = String(form.get('sampleId') || '').trim() || null;

    if (!(upload instanceof File)) {
      return NextResponse.json({ error: 'file is required.' }, { status: 400 });
    }
    if (upload.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: 'COA PDF exceeds the 15 MB limit.' }, { status: 413 });
    }

    const pdf = await parseScLabsCoaPdf(new Uint8Array(await upload.arrayBuffer()));
    const result = enrichScLabsBatchFromCoa(pdf, expectedSampleId);

    return NextResponse.json({
      ok: true,
      result,
      parsed: {
        sampleId: pdf.sampleId,
        productName: pdf.productName,
        batchNumber: pdf.batchNumber,
        uid: pdf.uid,
        collectedAt: pdf.collectedAt,
        receivedAt: pdf.receivedAt,
        testedAt: pdf.testedAt,
        overallStatus: pdf.overallStatus,
        analyteCount: pdf.analytes.length,
        sha256: pdf.sha256,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'COA PDF ingestion failed.' }, { status: 400 });
  }
}
