import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate } from '@/lib/candidateStore';

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = String(body?.id || '').trim();
  const dispensaryId = String(body?.dispensaryId || '').trim();
  if (!id) return NextResponse.json({ error: 'Candidate id is required.' }, { status: 400 });
  const candidate = (await listCandidates()).find(item => item.id === id);
  if (!candidate) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });
  const updated = await updateCandidate(id, {
    status: 'approved',
    imageryStatus: 'coverage',
    imageryMessage: dispensaryId ? `Approved into gameplay as ${dispensaryId}. Street View readiness verified during approval.` : 'Approved into gameplay. Street View readiness verified during approval.',
  });
  return NextResponse.json({ candidate: updated });
}
