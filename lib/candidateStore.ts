import crypto from 'crypto';
import { readRuntimeJson, writeRuntimeJson } from '@/lib/runtimeStore';

export type DispensaryCandidate = {
  id: string;
  name: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  website?: string;
  licenseNumber?: string;
  dataSource: string;
  sourceUrl?: string;
  sourceLicense?: string;
  status: 'candidate' | 'reviewing' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
};

const FILE = 'dispensary-candidates.json';
export async function listCandidates() { return readRuntimeJson<DispensaryCandidate[]>(FILE, []); }

export async function importCandidates(rows: Omit<DispensaryCandidate, 'id' | 'status' | 'createdAt' | 'updatedAt'>[]) {
  const items = await listCandidates();
  const now = new Date().toISOString();
  let added = 0;
  for (const row of rows) {
    const fingerprint = `${row.name}|${row.streetAddress || ''}|${row.city || ''}|${row.region || ''}`.toLowerCase();
    const duplicate = items.some((item) => `${item.name}|${item.streetAddress || ''}|${item.city || ''}|${item.region || ''}`.toLowerCase() === fingerprint);
    if (duplicate || !row.name.trim()) continue;
    items.push({ ...row, id: `candidate-${crypto.randomUUID()}`, status: 'candidate', createdAt: now, updatedAt: now });
    added++;
  }
  await writeRuntimeJson(FILE, items);
  return { added, total: items.length };
}

export async function updateCandidate(id: string, patch: Partial<DispensaryCandidate>) {
  const items = await listCandidates();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  items[index] = { ...items[index], ...patch, id: items[index].id, updatedAt: new Date().toISOString() };
  await writeRuntimeJson(FILE, items);
  return items[index];
}
