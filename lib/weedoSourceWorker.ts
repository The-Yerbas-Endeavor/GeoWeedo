import fs from 'fs';
import path from 'path';

export type SourceWorkerControl = {
  sourceId: string;
  pid: number;
  region: string | null;
  startedAt: string;
};

const controlDir = path.join(process.cwd(), 'data', 'source-updates');

function controlPath(sourceId: string) {
  return path.join(controlDir, `${sourceId}.worker.json`);
}

export function writeSourceWorkerControl(sourceId: string, pid: number, region?: string | null) {
  fs.mkdirSync(controlDir, { recursive: true });
  const record: SourceWorkerControl = {
    sourceId,
    pid,
    region: region || null,
    startedAt: new Date().toISOString(),
  };
  const target = controlPath(sourceId);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record, null, 2));
  fs.renameSync(temp, target);
  return record;
}

export function readSourceWorkerControl(sourceId: string): SourceWorkerControl | null {
  try {
    const record = JSON.parse(fs.readFileSync(controlPath(sourceId), 'utf8')) as Partial<SourceWorkerControl>;
    const pid = Number(record.pid);
    if (record.sourceId !== sourceId || !Number.isInteger(pid) || pid <= 1) return null;
    return {
      sourceId,
      pid,
      region: typeof record.region === 'string' && record.region ? record.region : null,
      startedAt: typeof record.startedAt === 'string' ? record.startedAt : '',
    };
  } catch {
    return null;
  }
}

export function clearSourceWorkerControl(sourceId: string, expectedPid?: number) {
  const record = readSourceWorkerControl(sourceId);
  if (expectedPid && record && record.pid !== expectedPid) return;
  try { fs.unlinkSync(controlPath(sourceId)); } catch {}
}

function commandForPid(pid: number) {
  if (process.platform !== 'linux') return '';
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); }
  catch { return ''; }
}

function runnerCommandMatches(record: SourceWorkerControl) {
  if (process.platform !== 'linux') return true;
  const command = commandForPid(record.pid);
  return command.includes('run-weedo-source-update.mjs') && command.includes(record.sourceId);
}

function discoverLegacyWorker(sourceId: string): SourceWorkerControl | null {
  if (process.platform !== 'linux') return null;
  try {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
      const command = commandForPid(pid);
      if (!command.includes('run-weedo-source-update.mjs') || !command.includes(sourceId)) continue;
      const parts = command.split(/\s+/);
      const sourceIndex = parts.lastIndexOf(sourceId);
      const region = sourceIndex >= 0 && parts[sourceIndex + 1] && /^[a-z]{2}$/i.test(parts[sourceIndex + 1])
        ? parts[sourceIndex + 1].toLowerCase()
        : null;
      return { sourceId, pid, region, startedAt: '' };
    }
  } catch {}
  return null;
}

export function signalSourceWorkerStop(sourceId: string) {
  const registered = readSourceWorkerControl(sourceId);
  const record = registered || discoverLegacyWorker(sourceId);
  const legacy = !registered && Boolean(record);
  if (!record) return { signaled: false, reason: 'No Cannlytics source worker is running.' as const, record: null, legacy: false };
  if (!runnerCommandMatches(record)) {
    if (registered) clearSourceWorkerControl(sourceId, record.pid);
    return { signaled: false, reason: 'The source worker process is no longer active.' as const, record, legacy };
  }
  try {
    // New runners catch SIGTERM and terminate their active child cleanly. Older
    // detached runners have no handler, so signal the detached process group to
    // prevent their Python child from being orphaned after deployment.
    process.kill(legacy ? -record.pid : record.pid, 'SIGTERM');
    return { signaled: true, reason: null, record, legacy };
  } catch (error) {
    if (registered) clearSourceWorkerControl(sourceId, record.pid);
    return {
      signaled: false,
      reason: error instanceof Error ? error.message : 'Unable to signal source worker.',
      record,
      legacy,
    };
  }
}
