import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { readApprovedDispensaries } from '@/lib/dispensaryStore';
import { ensureFinanceSchema, postSystemLedgerEntry } from '@/lib/financeLedger';
import { getDatabase } from '@/lib/sqlite';

export const runtime = 'nodejs';
const ATOMIC = 100_000_000;

function mapSponsorship(row: any) {
  return {
    id: row.id,
    dispensaryId: row.dispensary_id,
    amountYerb: Number(row.amount_atomic) / ATOMIC,
    paymentTxid: row.payment_txid || undefined,
    priorityWeight: Number(row.priority_weight || 1),
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const db = getDatabase();
  ensureFinanceSchema(db);
  const sponsorships = db.prepare('SELECT * FROM sponsorships ORDER BY created_at').all().map(mapSponsorship);
  return NextResponse.json({ sponsorships, dispensaries: await readApprovedDispensaries() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const dispensaryId = String(body?.dispensaryId || '');
  const amountYerb = Number(body?.amountYerb);
  const priorityWeight = Math.max(1, Math.floor(Number(body?.priorityWeight || 1)));
  const paymentTxid = String(body?.paymentTxid || '').trim() || null;
  const startsAt = new Date(body?.startsAt || Date.now());
  const endsAt = new Date(body?.endsAt || Date.now());
  const status = ['pending', 'active', 'expired', 'cancelled'].includes(String(body?.status)) ? String(body.status) : 'pending';

  if (!(await readApprovedDispensaries()).some((item) => item.id === dispensaryId)) return NextResponse.json({ error: 'Dispensary not found.' }, { status: 400 });
  if (!Number.isFinite(amountYerb) || amountYerb <= 0) return NextResponse.json({ error: 'Positive amountYerb is required.' }, { status: 400 });
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) return NextResponse.json({ error: 'Valid sponsorship dates are required.' }, { status: 400 });
  if (status === 'active' && !paymentTxid) return NextResponse.json({ error: 'A YERB payment transaction ID is required before activating a sponsorship.' }, { status: 400 });

  const db = getDatabase();
  ensureFinanceSchema(db);
  const id = body?.id ? String(body.id) : `sponsor-${crypto.randomUUID()}`;
  const existing = db.prepare('SELECT * FROM sponsorships WHERE id = ?').get(id) as any;
  const existingIncome = db.prepare("SELECT id, txid FROM system_ledger WHERE reference_type = 'sponsorship_payment' AND reference_id = ?").get(id) as any;
  if (existingIncome && paymentTxid && existingIncome.txid && existingIncome.txid !== paymentTxid) {
    return NextResponse.json({ error: 'The payment txid cannot be changed after sponsorship income has been posted.' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const amountAtomic = Math.round(amountYerb * ATOMIC);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (existing) {
      db.prepare(`UPDATE sponsorships SET dispensary_id = ?, amount_atomic = ?, payment_txid = ?, priority_weight = ?, status = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?`)
        .run(dispensaryId, amountAtomic, paymentTxid, priorityWeight, status, startsAt.toISOString(), endsAt.toISOString(), now, id);
    } else {
      db.prepare(`INSERT INTO sponsorships (id, dispensary_id, amount_atomic, payment_txid, priority_weight, status, starts_at, ends_at, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, dispensaryId, amountAtomic, paymentTxid, priorityWeight, status, startsAt.toISOString(), endsAt.toISOString(), now, now);
    }

    if (status === 'active' && paymentTxid && !existingIncome) {
      postSystemLedgerEntry({
        accountCode: 'sponsorship_income',
        entryType: 'sponsorship_payment',
        amountAtomic,
        referenceType: 'sponsorship_payment',
        referenceId: id,
        txid: paymentTxid,
        memo: `Sponsorship payment for ${dispensaryId}`,
        metadata: { adminId: admin.id, dispensaryId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
      }, db);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Could not save sponsorship.';
    if (/UNIQUE constraint failed/i.test(message)) return NextResponse.json({ error: 'That payment transaction or sponsorship reference is already recorded.' }, { status: 409 });
    throw error;
  }

  const saved = db.prepare('SELECT * FROM sponsorships WHERE id = ?').get(id) as any;
  return NextResponse.json({ sponsorship: mapSponsorship(saved) }, { status: existing ? 200 : 201 });
}
