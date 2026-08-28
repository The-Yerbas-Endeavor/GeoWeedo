import { promises as fs } from 'fs';
import path from 'path';

const runtimeDir = path.join(process.cwd(), 'data', 'runtime');

export async function readRuntimeJson<T>(name: string, fallback: T): Promise<T> {
  await fs.mkdir(runtimeDir, { recursive: true });
  const file = path.join(runtimeDir, name);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    await writeRuntimeJson(name, fallback);
    return fallback;
  }
}

export async function writeRuntimeJson<T>(name: string, value: T) {
  await fs.mkdir(runtimeDir, { recursive: true });
  const file = path.join(runtimeDir, name);
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, file);
}

export function runtimePath(...parts: string[]) {
  return path.join(runtimeDir, ...parts);
}
