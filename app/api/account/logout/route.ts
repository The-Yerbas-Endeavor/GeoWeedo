import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { USER_COOKIE } from '@/lib/userAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(USER_COOKIE)?.value;
  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    getDatabase().prepare('UPDATE user_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(new Date().toISOString(), tokenHash);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(USER_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires: new Date(0) });
  return response;
}
