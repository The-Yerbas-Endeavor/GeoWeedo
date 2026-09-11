import { NextRequest, NextResponse } from 'next/server';
import { fetchRetailId1A4, isRetailId1A4Url } from '@/lib/retailId1a4';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function currentCoaFileUrl(rawPayload: unknown) {
  const raw = rawPayload as any;
  const fileLink = raw?.coaCard?.fileLink;
  const candidates = Array.isArray(fileLink) ? fileLink : [fileLink];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      const url = new URL(candidate.trim());
      if (url.protocol === 'https:') return url.toString();
    } catch {}
  }
  return null;
}

export async function GET(request: NextRequest) {
  const source = String(request.nextUrl.searchParams.get('source') || '').trim();
  if (!source || !isRetailId1A4Url(source)) {
    return NextResponse.json({ ok: false, error: 'A valid 1A4 Retail ID source URL is required.' }, { status: 400 });
  }

  try {
    const record = await fetchRetailId1A4(source);
    const fileUrl = currentCoaFileUrl(record.rawPayload);
    if (fileUrl) {
      const response = NextResponse.redirect(fileUrl, 307);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
  } catch {
    // The stable Retail ID landing page remains a useful fallback if its
    // short-lived COA file URL cannot be refreshed at this moment.
  }

  const response = NextResponse.redirect(source, 307);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
