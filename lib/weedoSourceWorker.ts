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

function runnerCommandMatches(record: SourceWorkerControl) {
  if (process.platform !== 'linux') return true;
  try {
    const command = fs.readFileSync(`/proc/${record.pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
    return command.includes('run-weedo-source-update.mjs') && command.includes(record.sourceId);
  } catch {
    return false;
  }
}

export function signalSourceWorkerStop(sourceId: string) {
  const record = readSourceWorkerControl(sourceId);
  if (!record) return { signaled: false, reason: 'No registered source worker is running.' as const, record: null };
  if (!runnerCommandMatches(record)) {
    clearSourceWorkerControl(sourceId, record.pid);
    return { signaled: false, reason: 'The registered worker process is no longer active.' as const, record };
  }
  try {
    process.kill(record.pid, 'SIGTERM');
    return { signaled: true, reason: null, record };
  } catch (error) {
    clearSourceWorkerControl(sourceId, record.pid);
    return {
      signaled: false,
      reason: error instanceof Error ? error.message : 'Unable to signal source worker.',
      record,
    };
  }
}
