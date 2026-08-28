import crypto from 'crypto';
import { getDatabase } from '../lib/sqlite.ts';

const username = String(process.env.GEOWEEDO_ADMIN_USERNAME || '').trim();
const password = String(process.env.GEOWEEDO_ADMIN_PASSWORD || '');
const displayName = String(process.env.GEOWEEDO_ADMIN_DISPLAY_NAME || username).trim();

if (!username || username.length < 3) throw new Error('Set GEOWEEDO_ADMIN_USERNAME (minimum 3 characters).');
if (!password || password.length < 12) throw new Error('Set GEOWEEDO_ADMIN_PASSWORD (minimum 12 characters).');

const salt = crypto.randomBytes(16).toString('hex');
const derived = crypto.scryptSync(password, salt, 64).toString('hex');
const passwordHash = `scrypt$${salt}$${derived}`;
const id = `admin-${crypto.randomUUID()}`;
const now = new Date().toISOString();
const db = getDatabase();

const existing = db.prepare('SELECT id FROM admin_users WHERE username = ? COLLATE NOCASE').get(username);
if (existing) {
  db.prepare('UPDATE admin_users SET display_name = ?, password_hash = ?, active = 1, updated_at = ? WHERE id = ?')
    .run(displayName, passwordHash, now, existing.id);
  console.log(`Updated admin account: ${username}`);
} else {
  db.prepare(`INSERT INTO admin_users (id, username, display_name, password_hash, role, permissions_json, active, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'owner', ?, 1, ?, ?)`)
    .run(id, username, displayName, passwordHash, JSON.stringify(['*']), now, now);
  console.log(`Created admin account: ${username}`);
}
