import 'server-only';

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import type { RequestGeo } from '@/lib/requestGeo';

export const USER_COOKIE = 'geoweedo_user_session';
const SESSION_DAYS = 30;

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function ensureLoginLocations(db:any){
  db.exec(`CREATE TABLE IF NOT EXISTS user_login_locations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    ip_address TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    latitude REAL,
    longitude REAL,
    geo_source TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES user_sessions(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS user_login_locations_user_idx ON user_login_locations(user_id, created_at DESC);`);
}

export function issueWalletLoginChallenge(address: string) {
  const db = getDatabase();
  const now = new Date();
  const expires = new Date(now.getTime() + 10 * 60 * 1000);
  const nonce = crypto.randomBytes(24).toString('hex');
  const message = `GeoWeedo wallet login\nAddress: ${address}\nNonce: ${nonce}\nExpires: ${expires.toISOString()}`;
  db.prepare('DELETE FROM login_challenges WHERE expires_at <= ? OR used_at IS NOT NULL').run(now.toISOString());
  db.prepare(`INSERT INTO login_challenges (id, yerbas_address, challenge, purpose, expires_at, created_at)
              VALUES (?, ?, ?, 'wallet_login', ?, ?)`)
    .run(`lc-${crypto.randomUUID()}`, address, message, expires.toISOString(), now.toISOString());
  return { message, expiresAt: expires.toISOString() };
}

export function consumeWalletLoginChallenge(address: string) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const row = db.prepare(`SELECT id, challenge FROM login_challenges
                          WHERE yerbas_address = ? AND purpose = 'wallet_login' AND used_at IS NULL AND expires_at > ?
                          ORDER BY created_at DESC LIMIT 1`).get(address, now) as any;
  if (!row) return null;
  db.prepare('UPDATE login_challenges SET used_at = ? WHERE id = ?').run(now, row.id);
  return row.challenge as string;
}

export function createOrLoginUser(handle: string, address: string, userAgent?: string | null, geo?:RequestGeo|null) {
  const db = getDatabase();
  ensureLoginLocations(db);
  const now = new Date();
  const normalizedHandle = handle.trim();
  let user = db.prepare('SELECT * FROM users WHERE yerbas_address = ?').get(address) as any;
  if (!user) {
    const id = `user-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO users (id, username, display_name, yerbas_address, wallet_verified_at, reward_eligible, account_status, last_login_at, created_at, updated_at)
                VALUES (?, NULL, ?, ?, ?, 1, 'active', ?, ?, ?)`)
      .run(id, normalizedHandle || null, address, now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString());
    const walletId = `wallet-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO wallets (id, user_id, currency, status, created_at, updated_at) VALUES (?, ?, 'YERB', 'active', ?, ?)`)
      .run(walletId, id, now.toISOString(), now.toISOString());
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  } else {
    db.prepare(`UPDATE users SET display_name = COALESCE(NULLIF(?, ''), display_name),
                wallet_verified_at = ?, reward_eligible = 1, last_login_at = ?, updated_at = ? WHERE id = ?`)
      .run(normalizedHandle, now.toISOString(), now.toISOString(), now.toISOString(), user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  const wallet = db.prepare('SELECT id FROM wallets WHERE user_id = ?').get(user.id) as any;
  if (!wallet) {
    db.prepare(`INSERT INTO wallets (id, user_id, currency, status, created_at, updated_at) VALUES (?, ?, 'YERB', 'active', ?, ?)`)
      .run(`wallet-${crypto.randomUUID()}`, user.id, now.toISOString(), now.toISOString());
  }

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const sessionId=`us-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO user_sessions (id, user_id, token_hash, user_agent, expires_at, last_seen_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, user.id, hashToken(rawToken), userAgent || null, expires.toISOString(), now.toISOString(), now.toISOString());
  db.prepare(`INSERT INTO user_login_locations (id,user_id,session_id,ip_address,city,region,country,latitude,longitude,geo_source,user_agent,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`ull-${crypto.randomUUID()}`,user.id,sessionId,geo?.ip||null,geo?.city||null,geo?.region||null,geo?.country||null,geo?.latitude??null,geo?.longitude??null,geo?.source||'unavailable',userAgent||null,now.toISOString());

  return {
    token: rawToken,
    expires,
    user: {
      id: user.id,
      handle: normalizedHandle || user.display_name || user.username || 'Player',
      yerbasAddress: address,
      walletVerifiedAt: now.toISOString(),
      rewardEligible: true,
    },
  };
}

export function getUserFromRequest(request: NextRequest) {
  const token = request.cookies.get(USER_COOKIE)?.value;
  if (!token) return null;
  const db = getDatabase();
  const now = new Date().toISOString();
  const row = db.prepare(`SELECT u.id, u.username, u.display_name, u.yerbas_address, u.wallet_verified_at, u.reward_eligible,
                                 s.id AS session_id, w.id AS wallet_id
                          FROM user_sessions s JOIN users u ON u.id = s.user_id
                          LEFT JOIN wallets w ON w.user_id = u.id
                          WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.account_status = 'active'`)
    .get(hashToken(token), now) as any;
  if (!row) return null;
  db.prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?').run(now, row.session_id);
  return {
    id: row.id,
    handle: row.display_name || row.username || 'Player',
    yerbasAddress: row.yerbas_address,
    walletVerifiedAt: row.wallet_verified_at,
    rewardEligible: Boolean(row.reward_eligible),
    walletId: row.wallet_id as string | null,
    sessionId: row.session_id,
  };
}
