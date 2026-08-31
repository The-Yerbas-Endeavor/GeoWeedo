import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { getAutoWithdrawLimitYerb, setAutoWithdrawLimitYerb } from '@/lib/withdrawalPolicy';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ autoWithdrawLimitYerb: getAutoWithdrawLimitYerb() });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const value = Number(body?.autoWithdrawLimitYerb);
  try {
    const db = getDatabase();
    const saved = setAutoWithdrawLimitYerb(value, admin.id, db);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO audit_log
      (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
      VALUES (?, 'admin', ?, 'withdrawal.auto_limit_updated', 'app_setting', 'yerb_auto_withdraw_limit_yerb', ?, ?)`)
      .run(`audit-${crypto.randomUUID()}`, admin.id, JSON.stringify({ autoWithdrawLimitYerb: saved }), now);
    return NextResponse.json({ ok: true, autoWithdrawLimitYerb: saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update auto-withdraw limit.' }, { status: 400 });
  }
}
