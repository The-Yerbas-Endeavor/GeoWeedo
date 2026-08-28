import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, revokeAdminSession } from '@/lib/adminAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  revokeAdminSession(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires: new Date(0) });
  return response;
}
