import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const rows = getDatabase().prepare(`SELECT w.id, w.destination_address, w.amount_atomic, w.fee_atomic, w.status, w.requested_at, w.reviewed_at, w.sent_at, w.txid, w.failure_reason,
                                             u.username, u.display_name, u.yerbas_address
                                      FROM withdrawals w JOIN wallets wal ON wal.id = w.wallet_id JOIN users u ON u.id = wal.user_id
                                      ORDER BY w.requested_at DESC LIMIT 200`).all();
  return NextResponse.json({ withdrawals: rows });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = String(body?.id || '');
  const action = String(body?.action || '');
  if (!id || !['approve', 'reject'].includes(action)) return NextResponse.json({ error: 'Valid withdrawal id and action are required.' }, { status: 400 });

  const db = getDatabase();
  const withdrawal = db.prepare('SELECT id, status, hold_ledger_id FROM withdrawals WHERE id = ?').get(id) as any;
  if (!withdrawal || withdrawal.status !== 'requested') return NextResponse.json({ error: 'Withdrawal is not awaiting review.' }, { status: 409 });
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    if (action === 'approve') {
      db.prepare("UPDATE withdrawals SET status = 'approved', reviewed_by_admin_id = ?, reviewed_at = ? WHERE id = ?").run(admin.id, now, id);
    } else {
      db.prepare("UPDATE withdrawals SET status = 'rejected', reviewed_by_admin_id = ?, reviewed_at = ?, failure_reason = 'Rejected by administrator' WHERE id = ?").run(admin.id, now, id);
      if (withdrawal.hold_ledger_id) db.prepare("UPDATE wallet_ledger SET status = 'released', posted_at = ? WHERE id = ? AND status = 'held'").run(now, withdrawal.hold_ledger_id);
    }
    db.prepare(`INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, created_at)
                VALUES (?, 'admin', ?, ?, 'withdrawal', ?, ?)`)
      .run(`audit-${crypto.randomUUID()}`, admin.id, `withdrawal.${action}`, id, now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return NextResponse.json({ ok: true, id, status: action === 'approve' ? 'approved' : 'rejected' });
}
