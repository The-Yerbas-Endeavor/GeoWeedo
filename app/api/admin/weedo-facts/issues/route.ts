import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { listUnknownScanGroups } from '@/lib/weedoCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const requested = Number(request.nextUrl.searchParams.get('limit') || 100);
  const groups = listUnknownScanGroups(Number.isFinite(requested) ? requested : 100);
  return NextResponse.json({
    groups,
    totals: {
      groups: groups.length,
      uniquePayloads: groups.reduce((sum, row) => sum + Number(row.unique_payloads || 0), 0),
      scans: groups.reduce((sum, row) => sum + Number(row.scan_count || 0), 0),
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
