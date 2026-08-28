import { NextRequest, NextResponse } from 'next/server';
import { listCandidates, updateCandidate } from '@/lib/candidateStore';

function authorized(request: NextRequest) {
  const expected = process.env.GEOWEEDO_ADMIN_SECRET;
  return Boolean(expected) && request.headers.get('x-geoweedo-admin') === expected;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ candidates: await listCandidates() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'Candidate id is required.' }, { status: 400 });
  const allowed = ['candidate', 'reviewing', 'approved', 'rejected'];
  const patch: Record<string, unknown> = {};
  if (body.status && allowed.includes(body.status)) patch.status = body.status;
  for (const key of ['name','streetAddress','city','region','country','website','licenseNumber','sourceUrl','sourceLicense']) {
    if (body[key] !== undefined) patch[key] = String(body[key]).trim() || undefined;
  }
  for (const key of ['latitude','longitude']) {
    if (body[key] !== undefined && Number.isFinite(Number(body[key]))) patch[key] = Number(body[key]);
  }
  const updated = await updateCandidate(String(body.id), patch);
  if (!updated) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });
  return NextResponse.json({ candidate: updated });
}
