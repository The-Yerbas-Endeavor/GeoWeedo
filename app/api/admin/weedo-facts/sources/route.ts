import { spawn } from 'child_process';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { beginSourceUpdate, CANNLYTICS_REGIONS, getSourceSummaries, sourceCanStart, type WeedoDataSourceId } from '@/lib/weedoDataSources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ sources: getSourceSummaries() });
}

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const sourceId = String(body?.sourceId || '') as WeedoDataSourceId;
  const region = String(body?.region || '').toLowerCase();
  if (!['sc-labs', 'kannapedia', 'cannlytics'].includes(sourceId)) {
    return NextResponse.json({ error: 'Unknown data source.' }, { status: 400 });
  }
  if (sourceId === 'cannlytics' && !CANNLYTICS_REGIONS.some(([code]) => code === region)) {
    return NextResponse.json({ error: 'Choose a Cannlytics state before starting the update.' }, { status: 400 });
  }
  if (!sourceCanStart(sourceId)) {
    return NextResponse.json({ error: 'This source update is already running.' }, { status: 409 });
  }

  try {
    beginSourceUpdate(sourceId);
    const loader = path.join(process.cwd(), 'scripts', 'ts-extension-loader.mjs');
    const runner = path.join(process.cwd(), 'scripts', 'run-weedo-source-update.mjs');
    const child = spawn(process.execPath, [
      '--experimental-loader', loader,
      '--conditions=react-server',
      '--experimental-strip-types',
      runner,
      sourceId,
      ...(sourceId === 'cannlytics' ? [region] : []),
    ], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return NextResponse.json({ ok: true, sourceId, region: region || null, state: 'running' }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to start source update.' }, { status: 500 });
  }
}
