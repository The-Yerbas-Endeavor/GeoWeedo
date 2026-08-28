import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate, type DispensaryCandidate } from '@/lib/candidateStore';
import { saveApprovedDispensary } from '@/lib/dispensaryStore';
import { inspectKartaViewCoverage } from '@/lib/kartaViewCoverage';

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ candidates: await listCandidates() }, { headers: { 'Cache-Control': 'no-store' } });
}

async function promoteCandidate(item: DispensaryCandidate) {
  if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) return { ok: false, reason: 'missing_coordinates' };
  if (!item.city?.trim() || !item.region?.trim()) return { ok: false, reason: 'missing_location_fields' };
  if (item.imageryStatus !== 'coverage') return { ok: false, reason: 'imagery_not_playable' };

  try {
    const inspection = await inspectKartaViewCoverage(item.latitude as number, item.longitude as number);
    const photo = inspection.selected;
    if (!inspection.quality.playable || !photo?.id || !photo.imageUrl) return { ok: false, reason: 'imagery_revalidation_failed' };

    const saved = await saveApprovedDispensary({
      name: item.name,
      slug: `${item.name}-${item.city}-${item.id.slice(-8)}`,
      streetAddress: item.streetAddress,
      city: item.city,
      region: item.region,
      country: item.country || 'USA',
      latitude: item.latitude as number,
      longitude: item.longitude as number,
      website: item.website,
      dataSource: item.dataSource,
      sourceUrl: item.sourceUrl,
      sourceLicense: item.sourceLicense,
      recreational: false,
      medical: false,
      imageryProvider: 'kartaview',
      imageryPhotoId: photo.id,
      imagerySequenceId: photo.sequenceId || undefined,
      imageryLatitude: photo.lat,
      imageryLongitude: photo.lng,
      imageryHeading: photo.heading,
      imageryFieldOfView: photo.fieldOfView,
      imageryProjection: photo.projection,
      imageryUrl: photo.imageUrl,
      active: true,
    });

    await updateCandidate(item.id, {
      status: 'approved',
      imageryMessage: `Promoted to gameplay. Grade ${inspection.quality.grade}: ${inspection.quality.reason} Starting frame ${photo.id}.`,
    });
    return { ok: true, dispensaryId: saved.id };
  } catch {
    return { ok: false, reason: 'imagery_revalidation_error' };
  }
}

export async function PATCH(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);

  if (Array.isArray(body?.ids)) {
    const ids = Array.from(new Set<string>(body.ids.map((value: unknown) => String(value)).filter(Boolean))).slice(0, 5000);
    const action = String(body.action || '');
    if (!ids.length) return NextResponse.json({ error: 'At least one candidate id is required.' }, { status: 400 });
    if (!['approve', 'reject'].includes(action)) return NextResponse.json({ error: 'Bulk action must be approve or reject.' }, { status: 400 });

    const all = await listCandidates();
    const selected = all.filter((item) => ids.includes(item.id));
    let updated = 0;
    let skipped = 0;
    let promoted = 0;
    const skippedReasons: Record<string, number> = {};

    for (const item of selected) {
      if (action === 'approve') {
        const result = await promoteCandidate(item);
        if (result.ok) { updated++; promoted++; continue; }
        skipped++;
        const reason = result.reason || 'not_eligible';
        skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
        continue;
      }

      const result = await updateCandidate(item.id, { status: 'rejected' });
      if (result) updated++;
    }

    return NextResponse.json({ action, requested: ids.length, matched: selected.length, updated, promoted, skipped, skippedReasons });
  }

  if (!body?.id) return NextResponse.json({ error: 'Candidate id is required.' }, { status: 400 });
  const id = String(body.id);
  const all = await listCandidates();
  const current = all.find((item) => item.id === id);
  if (!current) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });

  if (body.status === 'approved') {
    const result = await promoteCandidate(current);
    if (!result.ok) return NextResponse.json({ error: `Candidate cannot enter gameplay: ${result.reason}.` }, { status: 400 });
    return NextResponse.json({ candidate: (await listCandidates()).find((item) => item.id === id), promoted: true });
  }

  const patch: Partial<DispensaryCandidate> = {};
  if (['candidate', 'reviewing', 'rejected'].includes(body.status)) patch.status = body.status as DispensaryCandidate['status'];
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
  const updated = await updateCandidate(id, patch);
  return NextResponse.json({ candidate: updated });
}
