import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/userAuth';
import { lookupWeedoFacts } from '@/lib/weedoFacts';
import { createScanContribution, saveScanHistory } from '@/lib/weedoMenus';
import { attachCoaUploadToSubmission, getOwnedCoaUpload } from '@/lib/weedoFactsUploads';

export const runtime = 'nodejs';

function asText(value: unknown, max = 500) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Login required.' }, { status: 401 });

  try {
    const body = await request.json();
    const identifierType = ['qr', 'upc', 'uid', 'batch', 'coa', 'unknown'].includes(body?.identifierType) ? body.identifierType : 'unknown';
    const identifierValue = asText(body?.identifierValue, 2048);
    if (!identifierValue) return NextResponse.json({ error: 'A scanned identifier is required.' }, { status: 400 });

    const coaUploadId = asText(body?.coaUploadId, 128);
    const coaUpload = coaUploadId ? getOwnedCoaUpload(user.id, coaUploadId) : null;
    if (coaUploadId && !coaUpload) {
      return NextResponse.json({ error: 'The attached COA upload was not found for this account.' }, { status: 400 });
    }
    if (coaUpload?.submission_id) {
      return NextResponse.json({ error: 'That COA upload is already attached to another submission.' }, { status: 409 });
    }
    const parsedCoa = coaUpload ? JSON.parse(coaUpload.parsed_json || '{}') : null;

    const existing = lookupWeedoFacts({ identifier: identifierValue, identifierType });
    const scanId = saveScanHistory({
      userId: user.id,
      identifierType,
      identifierValue,
      productId: existing?.productId || null,
      batchId: existing?.batchId || null,
      matchLevel: existing?.matchLevel || 'not_found',
    });

    const hasContribution = Boolean(
      coaUploadId || body?.dispensaryId || body?.menu || body?.sourceUrl || body?.coaUrl || body?.notes ||
      (!existing && (body?.productName || body?.brandName || body?.batchNumber || body?.uid || parsedCoa?.productName || parsedCoa?.batchNumber || parsedCoa?.uid))
    );

    if (!hasContribution) {
      return NextResponse.json({ ok: true, scanId, existing, submission: null });
    }

    const priceCents = Number.isFinite(Number(body?.menu?.priceCents)) ? Math.max(0, Math.round(Number(body.menu.priceCents))) : null;
    const submission = createScanContribution({
      userId: user.id,
      identifierType,
      identifierValue,
      productId: existing?.productId || asText(body?.productId, 128),
      batchId: existing?.batchId || asText(body?.batchId, 128),
      dispensaryId: asText(body?.dispensaryId, 128),
      brandName: asText(body?.brandName, 200) || existing?.brandName || null,
      productName: asText(body?.productName, 300) || existing?.productName || asText(parsedCoa?.productName, 300),
      productType: asText(body?.productType, 100) || existing?.productType || null,
      netContents: asText(body?.netContents, 100) || existing?.netContents || null,
      batchNumber: asText(body?.batchNumber, 200) || existing?.batchNumber || asText(parsedCoa?.batchNumber, 200),
      uid: asText(body?.uid, 300) || existing?.uid || asText(parsedCoa?.uid, 300),
      coaUrl: asText(body?.coaUrl, 2048) || existing?.coaUrl || null,
      sourceUrl: asText(body?.sourceUrl, 2048),
      notes: asText(body?.notes, 2000),
      menu: body?.menu ? {
        itemName: asText(body.menu.itemName, 300) || asText(body?.productName, 300) || existing?.productName || asText(parsedCoa?.productName, 300),
        category: asText(body.menu.category, 100),
        variant: asText(body.menu.variant, 150),
        packageSize: asText(body.menu.packageSize, 100) || asText(body?.netContents, 100) || existing?.netContents || null,
        priceCents,
        currency: asText(body.menu.currency, 8) || 'USD',
      } : null,
    });

    if (coaUploadId) attachCoaUploadToSubmission(user.id, coaUploadId, submission.id);

    return NextResponse.json({
      ok: true,
      scanId,
      existing,
      submission: {
        id: submission.id,
        status: submission.status,
        requestedMenuAdd: Boolean(submission.requested_menu_add),
        coaUploadId: coaUploadId || null,
        createdAt: submission.created_at,
      },
      message: coaUploadId
        ? 'Thanks — your scan and parsed COA were submitted together for review.'
        : 'Thanks — your scan was saved and the new information was submitted for review.',
    }, { status: 201 });
  } catch (error) {
    console.error('[weedo-facts/contribute]', error);
    return NextResponse.json({ error: 'Unable to save this scan right now.' }, { status: 500 });
  }
}
