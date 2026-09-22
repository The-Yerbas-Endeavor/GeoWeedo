import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  beginSourceUpdate,
  failSourceUpdate,
  finishSourceUpdate,
  heartbeatSourceUpdate,
  CANNLYTICS_REGIONS,
} from '../lib/weedoDataSources.ts';
import { clearSourceWorkerControl, writeSourceWorkerControl } from '../lib/weedoSourceWorker.ts';

const sourceId = process.argv[2];
const region = String(process.argv[3] || '').toLowerCase();
const validSources = ['sc-labs', 'kannapedia', 'cannlytics'];
const validRegions = new Set(CANNLYTICS_REGIONS.map(([code]) => code));
if (!validSources.includes(sourceId) || (sourceId === 'cannlytics' && !validRegions.has(region))) {
  console.error('Usage: node scripts/run-weedo-source-update.mjs <sc-labs|kannapedia|cannlytics> [cannlytics-state]');
  process.exit(1);
}

const logDir = path.resolve(process.cwd(), 'data', 'source-updates');
fs.mkdirSync(logDir, { recursive: true });
const logName = sourceId === 'cannlytics' ? `${sourceId}-${region}.log` : `${sourceId}.log`;
const logPath = path.join(logDir, logName);
const log = fs.openSync(logPath, 'a');
const startedAt = new Date().toISOString();
fs.writeSync(log, `\n\n=== ${startedAt} starting ${sourceId}${region ? ` ${region.toUpperCase()}` : ''} update ===\n`);

const MIN_CANNLYTICS_FREE_BYTES = 3 * 1024 * 1024 * 1024;
const STOP_MESSAGE = 'Stopped by admin. The last saved Cannlytics checkpoint was preserved and can be resumed safely.';

beginSourceUpdate(sourceId);
writeSourceWorkerControl(sourceId, process.pid, region || null);
let finalized = false;
let stopRequested = false;
let currentChild = null;
let forceKillTimer = null;

const heartbeat = setInterval(() => {
  try { heartbeatSourceUpdate(sourceId); } catch (error) {
    fs.writeSync(log, `\nHEARTBEAT WARNING: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}, 30_000);
heartbeat.unref?.();

function cleanupControl() {
  clearSourceWorkerControl(sourceId, process.pid);
  if (forceKillTimer) {
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }
}

function finish(code, errorMessage) {
  if (finalized) return;
  finalized = true;
  clearInterval(heartbeat);
  cleanupControl();
  const completedAt = new Date().toISOString();
  if (code === 0) {
    finishSourceUpdate(sourceId, { completedAt, region: region || null, logPath });
    fs.writeSync(log, `\n=== ${completedAt} ${sourceId}${region ? ` ${region.toUpperCase()}` : ''} update complete ===\n`);
  } else {
    const message = errorMessage || `Updater exited with code ${code ?? 'unknown'}. See ${logPath}.`;
    try { failSourceUpdate(sourceId, message); } catch (error) {
      fs.writeSync(log, `\nSTATE UPDATE WARNING: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    fs.writeSync(log, `\n=== ${completedAt} ${sourceId}${region ? ` ${region.toUpperCase()}` : ''} update failed: ${message} ===\n`);
  }
  fs.closeSync(log);
  process.exitCode = code || 0;
}

function finishStopped() {
  finish(1, STOP_MESSAGE);
}

function requestStop(signal = 'SIGTERM') {
  if (finalized || stopRequested) return;
  stopRequested = true;
  const requestedAt = new Date().toISOString();
  fs.writeSync(log, `\n--- ${requestedAt} stop requested by admin (${signal}); preserving last saved checkpoint ---\n`);
  if (!currentChild) {
    finishStopped();
    return;
  }
  try { currentChild.kill('SIGTERM'); } catch {}
  forceKillTimer = setTimeout(() => {
    if (!currentChild || finalized) return;
    fs.writeSync(log, `\n--- ${new Date().toISOString()} importer did not stop after 8s; forcing child exit ---\n`);
    try { currentChild.kill('SIGKILL'); } catch {}
  }, 8000);
  forceKillTimer.unref?.();
}

process.on('SIGTERM', () => requestStop('SIGTERM'));
process.on('SIGINT', () => requestStop('SIGINT'));

function commandForSource() {
  const currentYear = new Date().getUTCFullYear();
  if (sourceId === 'sc-labs') {
    return { executable: 'npm', args: ['run', 'weedo:import:sc-labs', '--', '--since', `${currentYear}-01-01`, '--limit', '1000', '--pages', '5'] };
  }
  if (sourceId === 'kannapedia') {
    return { executable: 'npm', args: ['run', 'weedo:import:kannapedia', '--', '--limit', '1500'] };
  }
  return {
    executable: 'python3',
    args: [path.join(process.cwd(), 'scripts', 'import-cannlytics-resumable.py'), '--state', region, '--chunk-size', '2500'],
  };
}

function lowPriorityCommand(command) {
  if (sourceId !== 'cannlytics') return command;

  const args = ['-n', '19'];
  if (fs.existsSync('/usr/bin/ionice')) args.push('/usr/bin/ionice', '-c', '3');
  args.push(command.executable, ...command.args);

  return {
    executable: fs.existsSync('/usr/bin/nice') ? '/usr/bin/nice' : 'nice',
    args,
  };
}

function serverIsBusy() {
  if (sourceId !== 'cannlytics') return false;
  const cores = Math.max(1, os.cpus().length);
  const oneMinuteLoad = os.loadavg()[0] || 0;
  const maxBackgroundStartLoad = Math.max(1, cores * 0.7);
  return oneMinuteLoad > maxBackgroundStartLoad;
}

function freeDiskBytes() {
  try {
    const stats = fs.statfsSync(process.cwd());
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function hasCannlyticsDiskHeadroom() {
  if (sourceId !== 'cannlytics') return true;
  const freeBytes = freeDiskBytes();
  if (freeBytes >= MIN_CANNLYTICS_FREE_BYTES) return true;

  const freeGiB = freeBytes / (1024 * 1024 * 1024);
  const minimumGiB = MIN_CANNLYTICS_FREE_BYTES / (1024 * 1024 * 1024);
  finish(
    1,
    `Cannlytics paused to protect production: only ${freeGiB.toFixed(2)} GiB disk space is free; at least ${minimumGiB.toFixed(0)} GiB is required before starting another chunk. Free disk space, then resume ${region.toUpperCase()}.`,
  );
  return false;
}

function runChunk() {
  if (finalized) return;
  if (stopRequested) {
    finishStopped();
    return;
  }
  if (!hasCannlyticsDiskHeadroom()) return;

  if (serverIsBusy()) {
    const delayedAt = new Date().toISOString();
    fs.writeSync(log, `\n--- ${delayedAt} production load is elevated; delaying Cannlytics chunk for 30s ---\n`);
    try { heartbeatSourceUpdate(sourceId); } catch {}
    setTimeout(runChunk, 30_000);
    return;
  }

  const baseCommand = commandForSource();
  const command = lowPriorityCommand(baseCommand);
  heartbeatSourceUpdate(sourceId);
  const child = spawn(command.executable, command.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      CANNLYTICS_COMMIT_EVERY: '50',
      CANNLYTICS_YIELD_MS: '100',
    },
    stdio: ['ignore', log, log],
  });
  currentChild = child;

  let spawnFailed = false;
  child.once('error', error => {
    spawnFailed = true;
    currentChild = null;
    finish(1, error.message);
  });
  child.once('close', code => {
    currentChild = null;
    if (spawnFailed || finalized) return;
    if (stopRequested) {
      finishStopped();
      return;
    }
    if (sourceId === 'cannlytics' && code === 75) {
      const checkpointAt = new Date().toISOString();
      fs.writeSync(log, `\n--- ${checkpointAt} ${region.toUpperCase()} checkpoint saved; cooling down 20s before next chunk ---\n`);
      heartbeatSourceUpdate(sourceId);
      setTimeout(runChunk, 20_000);
      return;
    }
    finish(code ?? 1);
  });
}

runChunk();
