import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { beginSourceUpdate, failSourceUpdate, finishSourceUpdate } from '../lib/weedoDataSources.ts';

const sourceId = process.argv[2];
if (!['sc-labs', 'kannapedia'].includes(sourceId)) {
  console.error('Usage: node scripts/run-weedo-source-update.mjs <sc-labs|kannapedia>');
  process.exit(1);
}

const logDir = path.resolve(process.cwd(), 'data', 'source-updates');
fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, `${sourceId}.log`);
const log = fs.openSync(logPath, 'a');
const startedAt = new Date().toISOString();
fs.writeSync(log, `\n\n=== ${startedAt} starting ${sourceId} update ===\n`);

beginSourceUpdate(sourceId);

const currentYear = new Date().getUTCFullYear();
const command = sourceId === 'sc-labs'
  ? ['run', 'weedo:import:sc-labs', '--', '--since', `${currentYear}-01-01`, '--limit', '1000', '--pages', '5']
  : ['run', 'weedo:import:kannapedia', '--', '--limit', '1500'];

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
    finishSourceUpdate(sourceId, { completedAt, logPath });
    fs.writeSync(log, `\n=== ${completedAt} ${sourceId} update complete ===\n`);
  } else {
    failSourceUpdate(sourceId, `Updater exited with code ${code ?? 'unknown'}. See ${logPath}.`);
    fs.writeSync(log, `\n=== ${completedAt} ${sourceId} update failed: exit ${code} ===\n`);
  }
  fs.closeSync(log);
  process.exitCode = code || 0;
});
