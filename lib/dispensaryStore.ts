import { promises as fs } from 'fs';
import path from 'path';

export type ImageryProvider = 'kartaview' | 'geoweedo';

export type ApprovedDispensary = {
  id: string;
  name: string;
  slug: string;
  streetAddress?: string;
  city: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  website?: string;
  recreational: boolean;
  medical: boolean;
  imageryProvider: ImageryProvider;
  imageryPhotoId: string;
  imagerySequenceId?: string;
  imageryLatitude: number;
  imageryLongitude: number;
  imageryHeading?: number;
  imageryFieldOfView?: number;
  imageryProjection?: string;
  imageryUrl: string;
  verified: true;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const runtimeDir = path.join(process.cwd(), 'data', 'runtime');
const storePath = path.join(runtimeDir, 'dispensaries.json');

async function ensureStore() {
  await fs.mkdir(runtimeDir, { recursive: true });
  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, '[]\n', 'utf8');
  }
}

export async function readApprovedDispensaries(): Promise<ApprovedDispensary[]> {
  await ensureStore();
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeApprovedDispensaries(items: ApprovedDispensary[]) {
  await ensureStore();
  const tempPath = `${storePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, storePath);
}

export async function saveApprovedDispensary(input: Omit<ApprovedDispensary, 'id' | 'verified' | 'createdAt' | 'updatedAt'>) {
  const items = await readApprovedDispensaries();
  const now = new Date().toISOString();
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const existingIndex = items.findIndex((item) => item.slug === slug);

  const next: ApprovedDispensary = {
    ...input,
    slug,
    id: existingIndex >= 0 ? items[existingIndex].id : `disp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    verified: true,
    createdAt: existingIndex >= 0 ? items[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) items[existingIndex] = next;
  else items.push(next);

  await writeApprovedDispensaries(items);
  return next;
}

export async function setDispensaryActive(id: string, active: boolean) {
  const items = await readApprovedDispensaries();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  items[index] = { ...items[index], active, updatedAt: new Date().toISOString() };
  await writeApprovedDispensaries(items);
  return items[index];
}
