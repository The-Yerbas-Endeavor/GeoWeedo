import crypto from 'crypto';
import { readRuntimeJson, writeRuntimeJson } from '@/lib/runtimeStore';

export type RewardEntry = {
  id: string;
  playerId: string;
  amountYerb: number;
  reason: string;
  reference?: string;
  status: 'pending' | 'held' | 'paid' | 'failed';
  txid?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
};

const FILE = 'rewards.json';

export async function listRewards() { return readRuntimeJson<RewardEntry[]>(FILE, []); }

export async function queueReward(playerId: string, amountYerb: number, reason: string, reference?: string) {
  const entries = await listRewards();
  const now = new Date().toISOString();
  if (reference) {
    const existing = entries.find((item) => item.reference === reference && item.playerId === playerId);
    if (existing) return existing;
  }
  const entry: RewardEntry = {
    id: `reward-${crypto.randomUUID()}`,
    playerId,
    amountYerb: Number(Math.max(0, amountYerb).toFixed(8)),
    reason: reason.slice(0, 120),
    reference: reference?.slice(0, 120),
    status: 'pending', createdAt: now, updatedAt: now,
  };
  entries.push(entry);
  await writeRuntimeJson(FILE, entries);
  return entry;
}

export async function updateReward(id: string, patch: Partial<RewardEntry>) {
  const entries = await listRewards();
  const index = entries.findIndex((item) => item.id === id);
  if (index < 0) return null;
  entries[index] = { ...entries[index], ...patch, id: entries[index].id, updatedAt: new Date().toISOString() };
  await writeRuntimeJson(FILE, entries);
  return entries[index];
}
