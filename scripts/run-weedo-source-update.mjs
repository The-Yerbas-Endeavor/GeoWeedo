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

beginSourceUpdate(sourceId);
let finalized = false;
const heartbeat = setInterval(() => {
  try { heartbeatSourceUpdate(sourceId); } catch (error) {
    fs.writeSync(log, `\nHEARTBEAT WARNING: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}, 30_000);
heartbeat.unref?.();

function finish(code, errorMessage) {
  if (finalized) return;
  finalized = true;
  clearInterval(heartbeat);
  const completedAt = new Date().toISOString();
  if (code === 0) {
    finishSourceUpdate(sourceId, { completedAt, region: region || null, logPath });
    fs.writeSync(log, `\n=== ${completedAt} ${sourceId}${region ? ` ${region.toUpperCase()}` : ''} update complete ===\n`);
  } else {
    const message = errorMessage || `Updater exited with code ${code ?? 'unknown'}. See ${logPath}.`;
    failSourceUpdate(sourceId, message);
    fs.writeSync(log, `\n=== ${completedAt} ${sourceId}${region ? ` ${region.toUpperCase()}` : ''} update failed: ${message} ===\n`);
  }
  fs.closeSync(log);
  process.exitCode = code || 0;
}

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
    args: [path.join(process.cwd(), 'scripts', 'import-cannlytics-resumable.py'), '--state', region, '--chunk-size', '10000'],
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

function runChunk() {
  if (finalized) return;

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
    },
    stdio: ['ignore', log, log],
  });

  let spawnFailed = false;
  child.once('error', error => {
    spawnFailed = true;
    finish(1, error.message);
  });
  child.once('close', code => {
    if (spawnFailed || finalized) return;
    if (sourceId === 'cannlytics' && code === 75) {
      const checkpointAt = new Date().toISOString();
      fs.writeSync(log, `\n--- ${checkpointAt} ${region.toUpperCase()} checkpoint saved; cooling down 15s before next chunk ---\n`);
      heartbeatSourceUpdate(sourceId);
      setTimeout(runChunk, 15_000);
      return;
    }
    finish(code ?? 1);
  });
}

runChunk();
