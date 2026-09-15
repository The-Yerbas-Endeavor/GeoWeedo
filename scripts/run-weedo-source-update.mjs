import fs from 'fs';
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
    args: [path.join(process.cwd(), 'scripts', 'import-cannlytics-resumable.py'), '--state', region, '--chunk-size', '25000'],
  };
}

function runChunk() {
  if (finalized) return;
  const command = commandForSource();
  heartbeatSourceUpdate(sourceId);
  const child = spawn(command.executable, command.args, {
    cwd: process.cwd(),
    env: process.env,
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
      fs.writeSync(log, `\n--- ${checkpointAt} ${region.toUpperCase()} checkpoint saved; continuing next chunk ---\n`);
      heartbeatSourceUpdate(sourceId);
      setTimeout(runChunk, 250);
      return;
    }
    finish(code ?? 1);
  });
}

runChunk();
