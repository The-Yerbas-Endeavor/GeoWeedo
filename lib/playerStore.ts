import crypto from 'crypto';
import { readRuntimeJson, writeRuntimeJson } from '@/lib/runtimeStore';

export type Player = {
  id: string;
  handle: string;
  yerbasAddress: string;
  walletVerifiedAt?: string;
  rewardEligible: boolean;
  createdAt: string;
  updatedAt: string;
};

type Challenge = { address: string; message: string; expiresAt: string };
const PLAYER_FILE = 'players.json';
const CHALLENGE_FILE = 'wallet-challenges.json';

export async function listPlayers() {
  return readRuntimeJson<Player[]>(PLAYER_FILE, []);
}

export async function issueWalletChallenge(address: string) {
  const clean = address.trim();
  const challenges = await readRuntimeJson<Record<string, Challenge>>(CHALLENGE_FILE, {});
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `GeoWeedo wallet verification\nAddress: ${clean}\nNonce: ${nonce}`;
  const challenge = { address: clean, message, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
  challenges[clean] = challenge;
  await writeRuntimeJson(CHALLENGE_FILE, challenges);
  return challenge;
}

export async function consumeWalletChallenge(address: string) {
  const challenges = await readRuntimeJson<Record<string, Challenge>>(CHALLENGE_FILE, {});
  const challenge = challenges[address];
  if (!challenge || Date.parse(challenge.expiresAt) < Date.now()) return null;
  delete challenges[address];
  await writeRuntimeJson(CHALLENGE_FILE, challenges);
  return challenge;
}

export async function upsertVerifiedPlayer(handle: string, address: string) {
  const players = await listPlayers();
  const now = new Date().toISOString();
  const cleanHandle = handle.trim().slice(0, 32) || `player-${address.slice(0, 6)}`;
  let player = players.find((item) => item.yerbasAddress === address);
  if (player) {
    player = { ...player, handle: cleanHandle, walletVerifiedAt: now, rewardEligible: true, updatedAt: now };
    players[players.findIndex((item) => item.id === player!.id)] = player;
  } else {
    player = { id: `player-${crypto.randomUUID()}`, handle: cleanHandle, yerbasAddress: address, walletVerifiedAt: now, rewardEligible: true, createdAt: now, updatedAt: now };
    players.push(player);
  }
  await writeRuntimeJson(PLAYER_FILE, players);
  return player;
}

export function signPlayerSession(playerId: string) {
  const secret = process.env.GEOWEEDO_SESSION_SECRET || process.env.GEOWEEDO_ADMIN_SECRET;
  if (!secret) throw new Error('GEOWEEDO_SESSION_SECRET is not configured.');
  const payload = Buffer.from(JSON.stringify({ playerId, exp: Date.now() + 30 * 24 * 60 * 60_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export async function playerFromSession(token?: string | null) {
  if (!token) return null;
  const secret = process.env.GEOWEEDO_SESSION_SECRET || process.env.GEOWEEDO_ADMIN_SECRET;
  if (!secret) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { playerId: string; exp: number };
    if (decoded.exp < Date.now()) return null;
    return (await listPlayers()).find((item) => item.id === decoded.playerId) ?? null;
  } catch { return null; }
}
