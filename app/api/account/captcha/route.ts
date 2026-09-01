import { NextResponse } from 'next/server';
import { createAccountCaptcha } from '@/lib/accountCaptcha';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const captcha = createAccountCaptcha();
    return NextResponse.json(captcha, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Anti-spam verification is unavailable.' },
      { status: 503 },
    );
  }
}
