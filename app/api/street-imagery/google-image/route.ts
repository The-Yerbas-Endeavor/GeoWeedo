import { NextRequest, NextResponse } from 'next/server';
import { incrementImageryProviderUsage } from '@/lib/imageryProviderSettings';

export const runtime = 'nodejs';

function validHeading(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 360;
}

export async function GET(request: NextRequest) {
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!apiKey) return NextResponse.json({ error: 'Google Street View is not configured.' }, { status: 503 });

  const pano = String(request.nextUrl.searchParams.get('pano') || '').trim();
  const heading = Number(request.nextUrl.searchParams.get('heading') || '0');
  if (!pano || pano.length > 512 || !validHeading(heading)) {
    return NextResponse.json({ error: 'Invalid Google Street View image request.' }, { status: 400 });
  }

  const url = new URL('https://maps.googleapis.com/maps/api/streetview');
  url.searchParams.set('size', '640x640');
  url.searchParams.set('pano', pano);
  url.searchParams.set('heading', String(heading));
  url.searchParams.set('pitch', '0');
  url.searchParams.set('fov', '90');
  url.searchParams.set('return_error_code', 'true');
  url.searchParams.set('key', apiKey);

  try {
    incrementImageryProviderUsage('google', 'image');
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      return NextResponse.json({ error: `Google Street View image returned ${response.status}.` }, { status: 502 });
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const image = await response.arrayBuffer();
    return new NextResponse(image, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Google Street View image request failed.',
    }, { status: 502 });
  }
}
