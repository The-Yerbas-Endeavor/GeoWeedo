import { NextRequest, NextResponse } from 'next/server';
import { listCandidates, updateCandidate, type DispensaryCandidate } from '@/lib/candidateStore';

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
  const patch: Partial<DispensaryCandidate> = {};
  if (['candidate', 'reviewing', 'approved', 'rejected'].includes(body.status)) patch.status = body.status as DispensaryCandidate['status'];
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.streetAddress !== undefined) patch.streetAddress = String(body.streetAddress).trim() || undefined;
  if (body.city !== undefined) patch.city = String(body.city).trim() || undefined;
  if (body.region !== undefined) patch.region = String(body.region).trim() || undefined;
  if (body.country !== undefined) patch.country = String(body.country).trim() || undefined;
  if (body.website !== undefined) patch.website = String(body.website).trim() || undefined;
  if (body.licenseNumber !== undefined) patch.licenseNumber = String(body.licenseNumber).trim() || undefined;
  if (body.sourceUrl !== undefined) patch.sourceUrl = String(body.sourceUrl).trim() || undefined;
  if (body.sourceLicense !== undefined) patch.sourceLicense = String(body.sourceLicense).trim() || undefined;
  if (body.latitude !== undefined && Number.isFinite(Number(body.latitude))) patch.latitude = Number(body.latitude);
  if (body.longitude !== undefined && Number.isFinite(Number(body.longitude))) patch.longitude = Number(body.longitude);
  const updated = await updateCandidate(String(body.id), patch);
  if (!updated) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });
  return NextResponse.json({ candidate: updated });
}
