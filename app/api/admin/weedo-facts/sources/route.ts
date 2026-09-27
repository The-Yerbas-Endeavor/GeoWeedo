import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { beginSourceUpdate, CANNLYTICS_REGIONS, failSourceUpdate, getSourceSummaries, sourceCanStart, type WeedoDataSourceId } from '@/lib/weedoDataSources';
import { signalSourceWorkerStop } from '@/lib/weedoSourceWorker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STOP_MESSAGE = 'Stopped by admin. The last saved Cannlytics checkpoint was preserved and can be resumed safely.';

function sourceErrorResponse(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error || fallback);
  const busy = /database is locked|database is busy|SQLITE_BUSY/i.test(raw);
  const message = busy
    ? 'Source status is temporarily busy while an import is writing to the database. GeoWeedo will retry automatically.'
    : raw || fallback;
  return NextResponse.json(
    { error: message, busy },
    { status: busy ? 503 : 500, headers: busy ? { 'Retry-After': '5' } : undefined },
  );
}

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    return NextResponse.json({ sources: getSourceSummaries() });
  } catch (error) {
    console.error('GeoWeedo source status error', error);
    return sourceErrorResponse(error, 'Unable to load data sources.');
  }
}

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const sourceId = String(body?.sourceId || '') as WeedoDataSourceId;
  const region = String(body?.region || '').toLowerCase();
  const action = String(body?.action || 'start').toLowerCase();
  if (!['sc-labs', 'kannapedia', 'cannlytics'].includes(sourceId)) {
    return NextResponse.json({ error: 'Unknown data source.' }, { status: 400 });
  }

  if (action === 'diagnose') {
    if (sourceId !== 'cannlytics') {
      return NextResponse.json({ error: 'Diagnostics are only available for Cannlytics state datasets.' }, { status: 400 });
    }
    if (!CANNLYTICS_REGIONS.some(([code]) => code === region)) {
      return NextResponse.json({ error: 'Choose a Cannlytics state before running diagnostics.' }, { status: 400 });
    }
    try {
      if (!sourceCanStart(sourceId)) {
        return NextResponse.json({ error: 'Wait for the active Cannlytics update to stop before running a source diagnostic.' }, { status: 409 });
      }
      const script = path.join(process.cwd(), 'scripts', 'diagnose-cannlytics-state.py');
      const diagnostic = spawnSync('python3', [script, '--state', region, '--sample', '5000'], {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf-8',
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      });
      if (diagnostic.error) throw diagnostic.error;
      if (diagnostic.status !== 0) throw new Error((diagnostic.stderr || diagnostic.stdout || 'Cannlytics diagnostic failed.').trim());
      const lines = String(diagnostic.stdout || '').trim().split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1);
      if (!last) throw new Error('Cannlytics diagnostic returned no result.');
      return NextResponse.json({ ok: true, diagnostic: JSON.parse(last) });
    } catch (error) {
      console.error('GeoWeedo Cannlytics diagnostic error', error);
      return sourceErrorResponse(error, 'Unable to diagnose Cannlytics source.');
    }
  }

  if (action === 'stop') {
    if (sourceId !== 'cannlytics') {
      return NextResponse.json({ error: 'Only the Cannlytics background importer supports remote stop.' }, { status: 400 });
    }
    try {
      const result = signalSourceWorkerStop(sourceId);
      if (!result.signaled) {
        return NextResponse.json({ error: result.reason || 'No Cannlytics worker is running.' }, { status: 409 });
      }
      if (result.legacy) {
        // Older runners do not catch SIGTERM to write their own final state. The
        // process group was terminated above, so mark the source resumable here.
        failSourceUpdate(sourceId, STOP_MESSAGE);
      }
      return NextResponse.json({
        ok: true,
        sourceId,
        region: result.record?.region || null,
        state: 'stopping',
        message: 'Stop requested. The active chunk will roll back if necessary and the last saved checkpoint will be preserved.',
      }, { status: 202 });
    } catch (error) {
      console.error('GeoWeedo source update stop error', error);
      return sourceErrorResponse(error, 'Unable to stop Cannlytics update.');
    }
  }

  if (action !== 'start') {
    return NextResponse.json({ error: 'Unknown source update action.' }, { status: 400 });
  }
  if (sourceId === 'cannlytics' && !CANNLYTICS_REGIONS.some(([code]) => code === region)) {
    return NextResponse.json({ error: 'Choose a Cannlytics state before starting the update.' }, { status: 400 });
  }

  try {
    if (!sourceCanStart(sourceId)) {
      return NextResponse.json({ error: 'This source update is already running.' }, { status: 409 });
    }

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
    console.error('GeoWeedo source update start error', error);
    return sourceErrorResponse(error, 'Unable to start source update.');
  }
}
