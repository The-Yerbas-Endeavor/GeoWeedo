import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/userAuth';
import { parseScLabsCoaPdf } from '@/lib/scLabsCoaPdf';
import { saveCoaUpload } from '@/lib/weedoFactsUploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const allowedTypes = new Set(['qr', 'upc', 'uid', 'batch', 'coa', 'unknown']);

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Login required.' }, { status: 401 });

  try {
    const form = await request.formData();
    const upload = form.get('file');
    const identifierValue = String(form.get('identifierValue') || '').trim();
    const requestedType = String(form.get('identifierType') || 'unknown').trim().toLowerCase();
    const identifierType = allowedTypes.has(requestedType) ? requestedType : 'unknown';
    if (!identifierValue || identifierValue.length > 2048) return NextResponse.json({ error: 'A valid scanned identifier is required.' }, { status: 400 });
    if (!(upload instanceof File)) return NextResponse.json({ error: 'Choose a supported COA PDF.' }, { status: 400 });
    if (upload.size < 5 || upload.size > MAX_PDF_BYTES) return NextResponse.json({ error: 'COA PDF must be between 5 bytes and 15 MB.' }, { status: 413 });
    if (upload.type && upload.type !== 'application/pdf') return NextResponse.json({ error: 'Only PDF uploads are accepted.' }, { status: 415 });

    const bytes = new Uint8Array(await upload.arrayBuffer());
    const parsed = await parseScLabsCoaPdf(bytes);
    const saved = saveCoaUpload({ userId: user.id, identifierType, identifierValue, originalFilename: upload.name || null, bytes, parsed });
    const analyteGroups = parsed.analytes.reduce((acc: Record<string, number>, row) => { acc[row.groupName] = (acc[row.groupName] || 0) + 1; return acc; }, {});

    return NextResponse.json({
      ok: true,
      upload: { id: saved.id, status: saved.status, sha256: saved.sha256 },
      parsed: {
        sampleId: parsed.sampleId,
        productName: parsed.productName,
        brandName: parsed.brandName,
        productType: parsed.productType,
        netContents: parsed.netContents,
        batchNumber: parsed.batchNumber,
        uid: parsed.uid,
        labName: parsed.labName,
        labLicenseNumber: parsed.labLicenseNumber,
        producerName: parsed.producerName,
        producerLicenseNumber: parsed.producerLicenseNumber,
        collectedAt: parsed.collectedAt,
        receivedAt: parsed.receivedAt,
        testedAt: parsed.testedAt,
        overallStatus: parsed.overallStatus,
        analyteCount: parsed.analytes.length,
        analyteGroups,
      },
      message: `COA parsed with ${parsed.analytes.length} report rows and attached as pending evidence.`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to parse this COA PDF.' }, { status: 400 });
  }
}
