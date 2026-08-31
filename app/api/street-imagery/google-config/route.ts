import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const apiKey = String(
    process.env.GOOGLE_MAPS_BROWSER_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '',
  ).trim();

  if (!apiKey) {
    return NextResponse.json({ error: 'Google Street View is not configured.' }, { status: 503 });
  }

  return NextResponse.json(
    { apiKey },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
