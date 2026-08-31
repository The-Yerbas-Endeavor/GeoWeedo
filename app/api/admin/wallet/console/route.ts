import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { yerbasRpc } from '@/lib/yerbasRpc';

export const runtime = 'nodejs';

const ALLOWED_METHODS = new Set([
  'help',
  'getblockchaininfo',
  'getnetworkinfo',
  'getwalletinfo',
  'getbalance',
  'getbalances',
  'getblockcount',
  'getbestblockhash',
  'getblockhash',
  'getblock',
  'getblockheader',
  'getdifficulty',
  'getmempoolinfo',
  'getrawmempool',
  'getpeerinfo',
  'getconnectioncount',
  'getnettotals',
  'getchaintips',
  'getchaintxstats',
  'gettxoutsetinfo',
  'gettxout',
  'getrawtransaction',
  'decoderawtransaction',
  'validateaddress',
  'getaddressinfo',
  'listtransactions',
  'listsinceblock',
  'listunspent',
  'gettransaction',
  'listreceivedbyaddress',
  'listaddressgroupings',
]);

function parseParams(value: unknown): unknown[] {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') throw new Error('Parameters must be a JSON array.');
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Parameters must be a JSON array.');
  return parsed;
}

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const method = String(body?.method || '').trim().toLowerCase();
  if (!method) return NextResponse.json({ error: 'Enter an RPC method.' }, { status: 400 });
  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json({
      error: `Method "${method}" is not enabled in the dashboard console.`,
      allowedMethods: Array.from(ALLOWED_METHODS),
    }, { status: 400 });
  }

  let params: unknown[];
  try {
    params = parseParams(body?.params);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid parameters.' }, { status: 400 });
  }

  const started = Date.now();
  try {
    const result = await yerbasRpc(method, params);
    return NextResponse.json({ method, params, result, elapsedMs: Date.now() - started }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({
      method,
      params,
      error: error instanceof Error ? error.message : 'Yerbas RPC command failed.',
      elapsedMs: Date.now() - started,
    }, { status: 502 });
  }
}
