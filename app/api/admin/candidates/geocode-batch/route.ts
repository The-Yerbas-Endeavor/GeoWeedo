import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listCandidates, updateCandidate } from '@/lib/candidateStore';

export const runtime = 'nodejs';

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { values.push(value); value = ''; }
    else value += char;
  }
  values.push(value);
  return values;
}

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(Number(body?.limit) || 1000, 10000));
  const all = await listCandidates();
  const missing = all.filter((item) => item.status === 'candidate' && (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)));
  const candidates = missing.filter((item) => Boolean(item.streetAddress?.trim())).slice(0, limit);
  const skippedWithoutStreet = missing.length - candidates.length;

  if (!candidates.length) {
    return NextResponse.json({ submitted: 0, matched: 0, unmatched: 0, skippedWithoutStreet, remaining: missing.length });
  }

  const lines = candidates.map((item) => [
    item.id,
    item.streetAddress || '',
    item.city || '',
    item.region || '',
    '',
  ].map(csvEscape).join(','));

  const form = new FormData();
  form.set('benchmark', 'Public_AR_Current');
  form.set('addressFile', new Blob([lines.join('\n')], { type: 'text/csv' }), 'geoweedo-addresses.csv');

  try {
    const response = await fetch('https://geocoding.geo.census.gov/geocoder/locations/addressbatch', {
      method: 'POST',
      body: form,
      headers: { 'User-Agent': 'GeoWeedo/0.6 (https://geoweedo.yerbas.org)' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`U.S. Census Geocoder returned ${response.status}`);
    const text = await response.text();
    const rows = text.split(/\r?\n/).filter((line) => line.trim());
    let matched = 0; let unmatched = 0;

    for (const line of rows) {
      const fields = parseCsvLine(line);
      const id = fields[0]?.trim();
      if (!id) continue;
      const status = fields[2]?.trim().toLowerCase();
      const coordinates = fields[5]?.trim() || '';
      const parts = coordinates.split(',').map((value) => Number(value.trim()));
      const longitude = parts[0]; const latitude = parts[1];
      if (status === 'match' && Number.isFinite(latitude) && Number.isFinite(longitude)) {
        await updateCandidate(id, {
          latitude,
          longitude,
          imageryStatus: 'unchecked',
          imageryCount: 0,
          imageryCheckedAt: undefined,
          imageryMessage: `Coordinates matched by U.S. Census Geocoder: ${fields[4] || 'matched address'}`,
        });
        matched++;
      } else {
        await updateCandidate(id, {
          imageryStatus: 'missing_coordinates',
          imageryMessage: 'U.S. Census Geocoder did not return an address match; manual review/geocoding required.',
        });
        unmatched++;
      }
    }

    const after = await listCandidates();
    const remaining = after.filter((item) => item.status === 'candidate' && (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude))).length;
    return NextResponse.json({ submitted: candidates.length, matched, unmatched, skippedWithoutStreet, remaining, provider: 'U.S. Census Geocoder' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Batch geocoding failed.' }, { status: 502 });
  }
}
