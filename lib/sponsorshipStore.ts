import crypto from 'crypto';
import { readRuntimeJson, writeRuntimeJson } from '@/lib/runtimeStore';

export type Sponsorship = {
  id: string;
  dispensaryId: string;
  amountYerb: number;
  paymentTxid?: string;
  priorityWeight: number;
  status: 'pending' | 'active' | 'expired' | 'cancelled';
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
};

const FILE = 'sponsorships.json';
export async function listSponsorships() { return readRuntimeJson<Sponsorship[]>(FILE, []); }

export async function saveSponsorship(input: Omit<Sponsorship, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const items = await listSponsorships();
  const now = new Date().toISOString();
  const index = input.id ? items.findIndex((item) => item.id === input.id) : -1;
  const next: Sponsorship = {
    ...input,
    id: index >= 0 ? items[index].id : `sponsor-${crypto.randomUUID()}`,
    amountYerb: Number(Math.max(0, input.amountYerb).toFixed(8)),
    priorityWeight: Math.max(1, Math.floor(input.priorityWeight || 1)),
    createdAt: index >= 0 ? items[index].createdAt : now,
    updatedAt: now,
  };
  if (index >= 0) items[index] = next; else items.push(next);
  await writeRuntimeJson(FILE, items);
  return next;
}

export async function activeSponsorshipMap() {
  const now = Date.now();
  const active = (await listSponsorships()).filter((item) => item.status === 'active' && Date.parse(item.startsAt) <= now && Date.parse(item.endsAt) > now);
  const map = new Map<string, Sponsorship>();
  for (const item of active) {
    const current = map.get(item.dispensaryId);
    if (!current || item.priorityWeight > current.priorityWeight) map.set(item.dispensaryId, item);
  }
  return map;
}
