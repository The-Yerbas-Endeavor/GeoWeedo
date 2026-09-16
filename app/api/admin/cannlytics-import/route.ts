import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATES = new Set(['ca','co','ct','fl','hi','ma','md','mi','nv','ny','or','ri','ut','wa']);
const RUNTIME_DIR = path.join(process.cwd(), 'data', 'runtime');
const STATUS_FILE = path.join(RUNTIME_DIR, 'cannlytics-admin-import.json');

type RunStatus = {
  running: boolean;
  pid?: number;
  state?: string;
  dryRun?: boolean;
  limit?: number;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  logFile?: string;
  error?: string;
};

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
}

function readStatus(): RunStatus {
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8')) as RunStatus;
  } catch {
    return { running: false };
  }
}

function writeStatus(status: RunStatus) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(STATUS_FILE, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function pidIsRunning(pid?: number) {
  if (!pid || !Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeStatus() {
  const status = readStatus();
  if (status.running && !pidIsRunning(status.pid)) {
    const updated: RunStatus = {
      ...status,
      running: false,
      completedAt: status.completedAt || new Date().toISOString(),
      error: status.error || 'Importer process is no longer running.',
    };
    writeStatus(updated);
    return updated;
  }
  return status;
}

function tailLog(logFile?: string) {
  if (!logFile) return '';
  const safeName = path.basename(logFile);
  const filePath = path.join(RUNTIME_DIR, safeName);
  if (!existsSync(filePath)) return '';
  try {
    const stat = statSync(filePath);
    const length = Math.min(stat.size, 32 * 1024);
    if (!length) return '';
    const fd = openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
      return buffer.toString('utf8').split('\n').slice(-60).join('\n').trim();
    } finally {
      closeSync(fd);
    }
  } catch {
    return '';
  }
}

function syncRows() {
  const db = getDatabase();
  const exists = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='cannlytics_state_sync' LIMIT 1").get() as any;
  if (!exists?.ok) return [];
  return db.prepare(`
    SELECT state_code,upstream_records,imported_records,linked_existing,unchanged_records,
           skipped_records,failed_records,last_started_at,last_completed_at,last_error,updated_at
      FROM cannlytics_state_sync
     ORDER BY state_code
  `).all() as any[];
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const status = normalizeStatus();
  return NextResponse.json({
    status,
    logTail: tailLog(status.logFile),
    states: syncRows(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const body = await request.json().catch(() => null) as any;
  const state = String(body?.state || '').trim().toLowerCase();
  const dryRun = Boolean(body?.dryRun);
  const requestedLimit = Math.floor(Number(body?.limit || 0));
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(500000, requestedLimit)) : 0;

  if (!STATES.has(state)) {
    return NextResponse.json({ error: 'Choose a supported Cannlytics state.' }, { status: 400 });
  }

  const current = normalizeStatus();
  if (current.running && pidIsRunning(current.pid)) {
    return NextResponse.json({
      error: `Cannlytics ${String(current.state || '').toUpperCase()} ${current.dryRun ? 'dry run' : 'import'} is already running.`,
      status: current,
    }, { status: 409 });
  }

  mkdirSync(RUNTIME_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = `cannlytics-${state}-${dryRun ? 'dry-run' : 'import'}-${stamp}.log`;
  const logPath = path.join(RUNTIME_DIR, logFile);
  const logFd = openSync(logPath, 'a');
  const args = ['scripts/import-cannlytics-safe.py', '--state', state];
  if (dryRun) args.push('--dry-run');
  if (limit > 0) args.push('--limit', String(limit));

  let child;
  try {
    child = spawn('python3', args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', logFd, logFd],
    });
  } catch (error) {
    closeSync(logFd);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not start Cannlytics importer.' }, { status: 500 });
  }
  closeSync(logFd);

  const started: RunStatus = {
    running: true,
    pid: child.pid,
    state,
    dryRun,
    limit,
    startedAt: new Date().toISOString(),
    logFile,
  };
  writeStatus(started);

  child.once('error', error => {
    writeStatus({
      ...started,
      running: false,
      completedAt: new Date().toISOString(),
      error: error.message,
    });
  });

  child.once('exit', code => {
    writeStatus({
      ...started,
      running: false,
      completedAt: new Date().toISOString(),
      exitCode: code,
      error: code === 0 ? undefined : `Importer exited with code ${code ?? 'unknown'}.`,
    });
  });

  return NextResponse.json({ ok: true, status: started }, { status: 202 });
}
