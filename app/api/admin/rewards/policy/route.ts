import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { getGameRewardPolicy, saveGameRewardPolicy, type GameRewardPolicy } from '@/lib/gameRewardPolicy';

export const runtime = 'nodejs';

function cleanPolicy(body: any): GameRewardPolicy {
  const yerbPerPoint = Number(body?.yerbPerPoint);
  const dailyCapYerb = Number(body?.dailyCapYerb);
  const perGameCapYerb = Number(body?.perGameCapYerb);
  if (![yerbPerPoint, dailyCapYerb, perGameCapYerb].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('Reward rate and caps must be non-negative numbers.');
  }
  return {
    enabled: Boolean(body?.enabled),
    yerbPerPoint,
    dailyCapYerb,
    perGameCapYerb,
    reviewRequired: body?.reviewRequired !== false,
  };
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ policy: getGameRewardPolicy() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const policy = cleanPolicy(await request.json());
    saveGameRewardPolicy(policy, admin.id);
    const db = getDatabase();
    db.prepare(`INSERT INTO audit_log (id,actor_type,actor_id,action,entity_type,entity_id,metadata_json,created_at)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(`audit-${crypto.randomUUID()}`, 'admin', admin.id, 'update_game_reward_policy', 'app_setting', 'game_reward_policy', JSON.stringify(policy), new Date().toISOString());
    return NextResponse.json({ policy });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save reward policy.' }, { status: 400 });
  }
}
