import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { yerbasRpc } from '@/lib/yerbasRpc';
import {
  ensureDepositScanSchema,
  getDepositScanStatus,
  scanYerbasDeposits,
} from '@/lib/yerbasDepositScanner';

export const runtime = 'nodejs';

const ATOMIC = 100_000_000;
const TREASURY_KEY = 'yerb_treasury_address';
const y = (n: any) => Number(n || 0) / ATOMIC;

type BlockchainInfo = {
  blocks?: number;
  headers?: number;
  chain?: string;
  verificationprogress?: number;
};

type WalletInfo = {
  walletversion?: number;
  balance?: number;
  unconfirmed_balance?: number;
  immature_balance?: number;
  txcount?: number;
};

function readStoredTreasuryAddress() {
  const db = getDatabase();
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(TREASURY_KEY) as
    | { value_json?: string }
    | undefined;
  if (!row?.value_json) return null;
  try {
    const value = JSON.parse(row.value_json);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function storeTreasuryAddress(address: string) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value_json, public, updated_by_admin_id, updated_at)
    VALUES (?, ?, 0, NULL, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      public = 0,
      updated_at = excluded.updated_at
  `).run(TREASURY_KEY, JSON.stringify(address), now);
  return address;
}

async function getTreasuryAddress() {
  const configured = String(process.env.YERB_TREASURY_ADDRESS || '').trim();
  if (configured) return configured;

  const stored = readStoredTreasuryAddress();
  if (stored) return stored;

  let created = '';
  try {
    created = String((await yerbasRpc<string>('getaccountaddress', ['geoweedo-treasury'])) || '').trim();
  } catch {
    // Fall through to getnewaddress for wallets without account support.
  }

  if (!created) {
    try {
      created = String((await yerbasRpc<string>('getnewaddress', ['geoweedo-treasury'])) || '').trim();
    } catch {
      try {
        created = String((await yerbasRpc<string>('getnewaddress', [])) || '').trim();
      } catch {
        created = '';
      }
    }
  }

  return created ? storeTreasuryAddress(created) : null;
}

async function getRpcStatus() {
  const configured = Boolean(
    process.env.YERB_RPC_URL && process.env.YERB_RPC_USER && process.env.YERB_RPC_PASSWORD,
  );
  const fallbackTreasury =
    String(process.env.YERB_TREASURY_ADDRESS || '').trim() || readStoredTreasuryAddress();

  if (!configured) {
    return {
      configured: false,
      connected: false,
      error: 'Yerbas RPC is not configured.',
      treasuryAddress: fallbackTreasury,
    };
  }

  try {
    const [chain, wallet, treasuryAddress] = await Promise.all([
      yerbasRpc<BlockchainInfo>('getblockchaininfo'),
      yerbasRpc<WalletInfo>('getwalletinfo'),
      getTreasuryAddress(),
    ]);

    return {
      configured: true,
      connected: true,
      url: process.env.YERB_RPC_URL,
      chain: chain.chain || 'main',
      blocks: Number(chain.blocks || 0),
      headers: Number(chain.headers || 0),
      verificationProgress: Number(chain.verificationprogress || 0),
      walletVersion: Number(wallet.walletversion || 0),
      walletBalanceYerb: Number(wallet.balance || 0),
      unconfirmedBalanceYerb: Number(wallet.unconfirmed_balance || 0),
      immatureBalanceYerb: Number(wallet.immature_balance || 0),
      txCount: Number(wallet.txcount || 0),
      treasuryAddress,
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      url: process.env.YERB_RPC_URL,
      treasuryAddress: fallbackTreasury,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const db = getDatabase();
  ensureDepositScanSchema(db);

  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM wallets) wallets,
      (SELECT COUNT(*) FROM wallet_addresses WHERE active = 1) activeAddresses,
      (SELECT COUNT(*) FROM deposits WHERE status NOT IN ('credited', 'confirmed')) pendingPlayerDeposits,
      (SELECT COUNT(*) FROM treasury_deposits WHERE status = 'pending') pendingTreasuryDeposits,
      (SELECT COUNT(*) FROM withdrawals WHERE status IN ('requested', 'held', 'approved', 'processing')) pendingWithdrawals,
      (SELECT COUNT(*) FROM reward_claims WHERE status IN ('pending', 'held')) pendingRewards
  `).get() as any;

  const totals = db.prepare(`
    SELECT
      COALESCE((SELECT SUM(amount_atomic) FROM wallet_ledger WHERE status = 'posted'), 0) ledgerBalance,
      COALESCE((SELECT SUM(amount_atomic) FROM wallet_ledger WHERE status = 'held' AND amount_atomic < 0), 0) heldDebits,
      COALESCE((SELECT SUM(amount_atomic) FROM deposits WHERE status IN ('credited', 'confirmed')), 0) deposits,
      COALESCE((SELECT SUM(amount_atomic) FROM treasury_deposits WHERE status IN ('pending', 'confirmed')), 0) treasuryDeposits,
      COALESCE((SELECT SUM(amount_atomic + fee_atomic) FROM withdrawals WHERE status IN ('sent', 'completed')), 0) withdrawals,
      COALESCE((SELECT SUM(amount_atomic) FROM wallet_ledger
        WHERE status = 'posted'
          AND (entry_type = 'reward_credit' OR reference_type IN ('reward', 'game_reward', 'admin_reward'))), 0) rewards
  `).get() as any;

  const walletUsers = db.prepare(`
    SELECT
      w.id AS walletId,
      w.user_id AS userId,
      u.username,
      u.display_name AS displayName,
      u.yerbas_address AS yerbasAddress,
      (SELECT a.address
       FROM wallet_addresses a
       WHERE a.wallet_id = w.id
         AND a.address_type = 'deposit'
         AND a.active = 1
       ORDER BY a.created_at DESC
       LIMIT 1) AS activeDepositAddress
    FROM wallets w
    JOIN users u ON u.id = w.user_id
    ORDER BY COALESCE(u.display_name, u.username, u.yerbas_address, u.id) COLLATE NOCASE
  `).all();

  const depositAddresses = db.prepare(`
    SELECT a.id, a.address, a.address_type, a.label, a.active, a.created_at,
           w.user_id, u.username, u.display_name
    FROM wallet_addresses a
    JOIN wallets w ON w.id = a.wallet_id
    LEFT JOIN users u ON u.id = w.user_id
    ORDER BY a.active DESC, a.created_at DESC
    LIMIT 250
  `).all();

  const recentDeposits = db.prepare(`
    SELECT d.id, d.address, d.txid, d.vout, d.amount_atomic, d.confirmations, d.status,
           d.detected_at, d.confirmed_at, w.user_id
    FROM deposits d
    JOIN wallets w ON w.id = d.wallet_id
    ORDER BY d.detected_at DESC
    LIMIT 50
  `).all();

  const treasuryDeposits = db.prepare(`
    SELECT id, address, txid, vout, amount_atomic, confirmations, status,
           block_hash, detected_at, confirmed_at, updated_at
    FROM treasury_deposits
    ORDER BY detected_at DESC
    LIMIT 50
  `).all();

  const recentWithdrawals = db.prepare(`
    SELECT x.id, x.destination_address, x.txid, x.amount_atomic, x.fee_atomic, x.status,
           x.requested_at, x.sent_at, w.user_id
    FROM withdrawals x
    JOIN wallets w ON w.id = x.wallet_id
    ORDER BY x.requested_at DESC
    LIMIT 25
  `).all();

  const recentLedger = db.prepare(`
    SELECT l.id, l.entry_type, l.amount_atomic, l.status, l.reference_type,
           l.reference_id, l.txid, l.confirmations, l.created_at, w.user_id
    FROM wallet_ledger l
    JOIN wallets w ON w.id = l.wallet_id
    ORDER BY l.created_at DESC
    LIMIT 50
  `).all();

  const rpc = await getRpcStatus();
  const depositScan = getDepositScanStatus(db);
  const pendingPlayerDeposits = Number(counts.pendingPlayerDeposits || 0);
  const pendingTreasuryDeposits = Number(counts.pendingTreasuryDeposits || 0);
  const rawLedgerAtomic = Number(totals.ledgerBalance || 0);
  const heldDebitAtomic = Number(totals.heldDebits || 0);
  const availableAtomic = Math.max(0, rawLedgerAtomic + heldDebitAtomic);

  return NextResponse.json(
    {
      rpc,
      depositScan,
      summary: {
        wallets: Number(counts.wallets || 0),
        activeAddresses: Number(counts.activeAddresses || 0),
        pendingDeposits: pendingPlayerDeposits + pendingTreasuryDeposits,
        pendingPlayerDeposits,
        pendingTreasuryDeposits,
        pendingWithdrawals: Number(counts.pendingWithdrawals || 0),
        pendingRewards: Number(counts.pendingRewards || 0),
        ledgerBalanceYerb: y(availableAtomic),
        rawLedgerBalanceYerb: y(rawLedgerAtomic),
        heldYerb: y(Math.abs(heldDebitAtomic)),
        confirmedDepositsYerb: y(totals.deposits),
        treasuryDepositsYerb: y(totals.treasuryDeposits),
        sentWithdrawalsYerb: y(totals.withdrawals),
        postedRewardsYerb: y(totals.rewards),
      },
      walletUsers,
      depositAddresses,
      recentDeposits: recentDeposits.map((r: any) => ({ ...r, amountYerb: y(r.amount_atomic) })),
      treasuryDeposits: treasuryDeposits.map((r: any) => ({ ...r, amountYerb: y(r.amount_atomic) })),
      recentWithdrawals: recentWithdrawals.map((r: any) => ({
        ...r,
        amountYerb: y(r.amount_atomic),
        feeYerb: y(r.fee_atomic),
      })),
      recentLedger: recentLedger.map((r: any) => ({ ...r, amountYerb: y(r.amount_atomic) })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const action = String(body?.action || 'assignAddress');

  if (action === 'scanDeposits') {
    try {
      const scan = await scanYerbasDeposits();
      return NextResponse.json({ scan });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Could not scan Yerbas wallet.' },
        { status: 502 },
      );
    }
  }

  const walletId = String(body?.walletId || '').trim();
  if (!walletId) return NextResponse.json({ error: 'walletId is required.' }, { status: 400 });

  const db = getDatabase();
  const wallet = db.prepare(`
    SELECT w.id, w.user_id, u.username, u.display_name
    FROM wallets w
    JOIN users u ON u.id = w.user_id
    WHERE w.id = ?
  `).get(walletId) as any;

  if (!wallet) return NextResponse.json({ error: 'Wallet not found.' }, { status: 404 });

  const existing = db.prepare(`
    SELECT id, address
    FROM wallet_addresses
    WHERE wallet_id = ? AND address_type = 'deposit' AND active = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).get(walletId) as any;

  if (existing?.address) {
    return NextResponse.json({
      address: existing.address,
      existing: true,
      walletId,
      userId: wallet.user_id,
    });
  }

  try {
    let address: string;
    try {
      address = String(await yerbasRpc<string>('getnewaddress', [`geoweedo:${walletId}`]));
    } catch {
      address = String(await yerbasRpc<string>('getnewaddress', []));
    }

    if (!address) throw new Error('Yerbas Core returned an empty address.');

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO wallet_addresses (id, wallet_id, address, address_type, label, active, created_at)
      VALUES (?, ?, ?, 'deposit', ?, 1, ?)
    `).run(
      `wa-${crypto.randomUUID()}`,
      walletId,
      address,
      `GeoWeedo ${wallet.display_name || wallet.username || wallet.user_id}`,
      now,
    );

    db.prepare(`
      INSERT INTO audit_log
        (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `audit-${crypto.randomUUID()}`,
      'admin',
      admin.id,
      'wallet.deposit_address_created',
      'wallet',
      walletId,
      JSON.stringify({ userId: wallet.user_id, address }),
      now,
    );

    return NextResponse.json(
      { address, existing: false, walletId, userId: wallet.user_id },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not generate deposit address.' },
      { status: 502 },
    );
  }
}
