import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { getUserFromRequest } from '@/lib/userAuth';
import { yerbasRpc } from '@/lib/yerbasRpc';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user || !user.walletId) return NextResponse.json({ error: 'Login required.' }, { status: 401 });
  const db = getDatabase();
  const existing = db.prepare("SELECT address FROM wallet_addresses WHERE wallet_id = ? AND address_type = 'deposit' AND active = 1 ORDER BY created_at LIMIT 1").get(user.walletId) as any;
  if (existing?.address) return NextResponse.json({ address: existing.address, existing: true });

  try {
    let address: string;
    try {
      address = String(await yerbasRpc<string>('getnewaddress', [`geoweedo:${user.walletId}`]));
    } catch {
      // Older Yerbas/Bitcoin-derived wallets may not accept a label parameter.
      address = String(await yerbasRpc<string>('getnewaddress', []));
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO wallet_addresses (id, wallet_id, address, address_type, label, active, created_at)
                VALUES (?, ?, ?, 'deposit', ?, 1, ?)`)
      .run(`wa-${crypto.randomUUID()}`, user.walletId, address, `GeoWeedo ${user.handle}`, now);
    return NextResponse.json({ address, existing: false }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not generate deposit address.' }, { status: 502 });
  }
}
