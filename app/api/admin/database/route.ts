import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase, getDatabasePath } from '@/lib/sqlite';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const db = getDatabase();
  const tables = [
    'admin_users', 'admin_sessions', 'users', 'user_sessions', 'wallets', 'wallet_addresses',
    'wallet_ledger', 'deposits', 'withdrawals', 'dispensaries', 'dispensary_candidates',
    'map_locations', 'imagery_assets', 'games', 'game_rounds', 'reward_claims', 'sponsorships',
    'daily_challenges', 'leaderboard_entries', 'notifications', 'audit_log', 'rpc_jobs',
  ];

  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number | bigint };
    counts[table] = Number(row.count);
  }

  const migration = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
  const journal = db.prepare('PRAGMA journal_mode').get();
  const foreignKeys = db.prepare('PRAGMA foreign_keys').get();

  return NextResponse.json({
    ok: true,
    database: 'SQLite',
    path: getDatabasePath(),
    migration,
    journal,
    foreignKeys,
    counts,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
