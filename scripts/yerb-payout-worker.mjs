import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const runtime = path.join(root, 'data', 'runtime');
const rewardsPath = path.join(runtime, 'rewards.json');
const playersPath = path.join(runtime, 'players.json');
const execute = process.argv.includes('--execute');
const enabled = process.env.YERB_PAYOUTS_ENABLED === 'true';
const dailyCap = Number(process.env.NEXT_PUBLIC_YERB_DAILY_CAP || 25);

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temp, file);
}

async function rpc(method, params = []) {
  const { YERB_RPC_URL, YERB_RPC_USER, YERB_RPC_PASSWORD } = process.env;
  if (!YERB_RPC_URL || !YERB_RPC_USER || !YERB_RPC_PASSWORD) throw new Error('Yerbas RPC environment is incomplete.');
  const auth = Buffer.from(`${YERB_RPC_USER}:${YERB_RPC_PASSWORD}`).toString('base64');
  const response = await fetch(YERB_RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` }, body: JSON.stringify({ jsonrpc: '1.0', id: 'geoweedo-payout', method, params }) });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `RPC HTTP ${response.status}`);
  return payload.result;
}

const players = await readJson(playersPath, []);
const rewards = await readJson(rewardsPath, []);
const playerMap = new Map(players.map((player) => [player.id, player]));
const today = new Date().toISOString().slice(0, 10);
const paidToday = new Map();
for (const reward of rewards) {
  if (reward.status === 'paid' && String(reward.paidAt || '').startsWith(today)) paidToday.set(reward.playerId, (paidToday.get(reward.playerId) || 0) + Number(reward.amountYerb || 0));
}

const pending = rewards.filter((reward) => reward.status === 'pending');
console.log(`GeoWeedo payout worker: ${pending.length} pending reward(s). mode=${execute && enabled ? 'EXECUTE' : 'DRY-RUN'}`);

for (const reward of pending) {
  const player = playerMap.get(reward.playerId);
  if (!player?.rewardEligible || !player.walletVerifiedAt || !player.yerbasAddress) {
    console.log(`HOLD ${reward.id}: player is not wallet-verified.`);
    if (execute && enabled) { reward.status = 'held'; reward.error = 'Player is not wallet verified.'; reward.updatedAt = new Date().toISOString(); await writeJson(rewardsPath, rewards); }
    continue;
  }
  const remaining = Math.max(0, dailyCap - (paidToday.get(player.id) || 0));
  const amount = Number(Math.min(Number(reward.amountYerb), remaining).toFixed(8));
  if (amount <= 0) { console.log(`HOLD ${reward.id}: daily cap reached.`); continue; }
  console.log(`${execute && enabled ? 'PAY' : 'WOULD PAY'} ${amount} YERB -> ${player.yerbasAddress} (${reward.id})`);
  if (!execute || !enabled) continue;
  try {
    const txid = await rpc('sendtoaddress', [player.yerbasAddress, amount, `GeoWeedo ${reward.id}`, reward.reason || 'GeoWeedo reward']);
    const now = new Date().toISOString();
    reward.status = 'paid'; reward.txid = String(txid); reward.paidAt = now; reward.updatedAt = now; delete reward.error;
    paidToday.set(player.id, (paidToday.get(player.id) || 0) + amount);
    await writeJson(rewardsPath, rewards);
    console.log(`PAID ${reward.id}: ${txid}`);
  } catch (error) {
    reward.status = 'failed'; reward.error = error instanceof Error ? error.message : String(error); reward.updatedAt = new Date().toISOString();
    await writeJson(rewardsPath, rewards);
    console.error(`FAILED ${reward.id}: ${reward.error}`);
  }
}

if (execute && !enabled) {
  console.error('Execution requested, but YERB_PAYOUTS_ENABLED is not true. No funds were sent.');
  process.exitCode = 2;
}
