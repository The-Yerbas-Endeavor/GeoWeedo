import 'server-only';

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { effectivePermissions, permissionForAdminRequest, type AdminPermission } from '@/lib/adminPermissions';

export const ADMIN_COOKIE = 'geoweedo_admin_session';
const SESSION_HOURS = 12;

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashAdminPassword(password:string){
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=crypto.scryptSync(password,salt,64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, expected] = encoded.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

export function loginAdmin(username: string, password: string, userAgent?: string | null) {
  const db = getDatabase();
  const admin = db.prepare('SELECT id, username, display_name, password_hash, role, permissions_json, active FROM admin_users WHERE username = ? COLLATE NOCASE').get(username) as any;
  if (!admin || !admin.active || !verifyPassword(password, admin.password_hash)) return null;

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const id = `as-${crypto.randomUUID()}`;
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  db.prepare(`INSERT INTO admin_sessions (id, admin_user_id, token_hash, user_agent, expires_at, last_seen_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, admin.id, hashToken(rawToken), userAgent || null, expires.toISOString(), now.toISOString(), now.toISOString());
  db.prepare('UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now.toISOString(), now.toISOString(), admin.id);
  const permissions=effectivePermissions(admin.role,admin.permissions_json);
  return { token: rawToken, expires, admin: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role, permissions } };
}

export function getAdminFromRequest(request: NextRequest) {
  const rawToken = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!rawToken) return null;
  const now = new Date().toISOString();
  const db = getDatabase();
  const row = db.prepare(`SELECT a.id, a.username, a.display_name, a.role, a.permissions_json, s.id AS session_id
                          FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_user_id
                          WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.active = 1`)
    .get(hashToken(rawToken), now) as any;
  if (!row) return null;
  const permissions=effectivePermissions(row.role,row.permissions_json);
  const required=permissionForAdminRequest(request.nextUrl.pathname,request.method);
  if(required&&!permissions.includes(required))return null;
  db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?').run(now, row.session_id);
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, permissions, sessionId: row.session_id };
}

export function adminHasPermission(admin:{permissions?:AdminPermission[]}|null|undefined,permission:AdminPermission){
  return Boolean(admin?.permissions?.includes(permission));
}

export function revokeAdminSession(request: NextRequest) {
  const rawToken = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!rawToken) return;
  getDatabase().prepare('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), hashToken(rawToken));
}
