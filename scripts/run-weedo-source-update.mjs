import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { beginSourceUpdate, failSourceUpdate, finishSourceUpdate, CANNLYTICS_REGIONS } from '../lib/weedoDataSources.ts';

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

const currentYear = new Date().getUTCFullYear();
let command;
if (sourceId === 'sc-labs') {
  command = ['run', 'weedo:import:sc-labs', '--', '--since', `${currentYear}-01-01`, '--limit', '1000', '--pages', '5'];
} else if (sourceId === 'kannapedia') {
  command = ['run', 'weedo:import:kannapedia', '--', '--limit', '1500'];
} else {
  command = ['run', 'weedo:import:cannlytics', '--', '--state', region];
}

const child = spawn('npm', command, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', log, log],
});

child.on('error', error => {
  failSourceUpdate(sourceId, error);
  fs.writeSync(log, `\nSOURCE UPDATE ERROR: ${error.message}\n`);
  fs.closeSync(log);
  process.exitCode = 1;
});

child.on('close', code => {
  const completedAt = new Date().toISOString();
  if (code === 0) {
    finishSourceUpdate(sourceId, { completedAt, region: region || null, logPath });
    fs.writeSync(log, `\n=== ${completedAt} ${sourceId}${region ? ` ${region.toUpperCase()}` : ''} update complete ===\n`);
  } else {
    failSourceUpdate(sourceId, `Updater exited with code ${code ?? 'unknown'}. See ${logPath}.`);
    fs.writeSync(log, `\n=== ${completedAt} ${sourceId}${region ? ` ${region.toUpperCase()}` : ''} update failed: exit ${code} ===\n`);
  }
  fs.closeSync(log);
  process.exitCode = code || 0;
});
