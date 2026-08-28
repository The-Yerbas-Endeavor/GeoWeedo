import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE, loginAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  if (!username || !password) return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });

  const result = loginAdmin(username, password, request.headers.get('user-agent'));
  if (!result) return NextResponse.json({ error: 'Invalid admin credentials.' }, { status: 401 });

  const response = NextResponse.json({ admin: result.admin });
  response.cookies.set(ADMIN_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: result.expires,
  });
  return response;
}
