import { mkdirSync } from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const runtimeDir = path.join(process.cwd(), 'data', 'runtime');
const databasePath = path.join(runtimeDir, 'geoweedo.sqlite');

let database: DatabaseSync | null = null;

function initializeSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      public INTEGER NOT NULL DEFAULT 0,
      updated_by_admin_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      permissions_json TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      ip_hash TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE COLLATE NOCASE,
      display_name TEXT,
      email TEXT UNIQUE COLLATE NOCASE,
      email_verified_at TEXT,
      password_hash TEXT,
      yerbas_address TEXT UNIQUE,
      wallet_verified_at TEXT,
      reward_eligible INTEGER NOT NULL DEFAULT 0,
      account_status TEXT NOT NULL DEFAULT 'active',
      avatar_url TEXT,
      country TEXT,
      timezone TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      ip_hash TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS login_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      yerbas_address TEXT,
      challenge TEXT NOT NULL UNIQUE,
      purpose TEXT NOT NULL DEFAULT 'wallet_login',
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'YERB',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallet_addresses (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL,
      address TEXT NOT NULL UNIQUE,
      address_type TEXT NOT NULL DEFAULT 'deposit',
      derivation_ref TEXT,
      label TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY(wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      amount_atomic INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'posted',
      reference_type TEXT,
      reference_id TEXT,
      txid TEXT,
      block_height INTEGER,
      confirmations INTEGER,
      memo TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      posted_at TEXT,
      FOREIGN KEY(wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL,
      address TEXT NOT NULL,
      txid TEXT NOT NULL,
      vout INTEGER NOT NULL DEFAULT 0,
      amount_atomic INTEGER NOT NULL,
      block_height INTEGER,
      confirmations INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'detected',
      credited_ledger_id TEXT,
      detected_at TEXT NOT NULL,
      confirmed_at TEXT,
      UNIQUE(txid, vout),
      FOREIGN KEY(wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
      FOREIGN KEY(credited_ledger_id) REFERENCES wallet_ledger(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL,
      destination_address TEXT NOT NULL,
      amount_atomic INTEGER NOT NULL,
      fee_atomic INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'requested',
      request_ip_hash TEXT,
      requested_at TEXT NOT NULL,
      reviewed_by_admin_id TEXT,
      reviewed_at TEXT,
      sent_at TEXT,
      txid TEXT UNIQUE,
      failure_reason TEXT,
      hold_ledger_id TEXT,
      debit_ledger_id TEXT,
      FOREIGN KEY(wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
      FOREIGN KEY(reviewed_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      FOREIGN KEY(hold_ledger_id) REFERENCES wallet_ledger(id) ON DELETE SET NULL,
      FOREIGN KEY(debit_ledger_id) REFERENCES wallet_ledger(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS dispensaries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      street_address TEXT,
      city TEXT NOT NULL,
      region TEXT NOT NULL,
      postal_code TEXT,
      country TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      website TEXT,
      phone TEXT,
      license_number TEXT,
      data_source TEXT,
      source_url TEXT,
      source_license TEXT,
      recreational INTEGER NOT NULL DEFAULT 0,
      medical INTEGER NOT NULL DEFAULT 0,
      imagery_provider TEXT NOT NULL,
      imagery_photo_id TEXT NOT NULL,
      imagery_sequence_id TEXT,
      imagery_latitude REAL NOT NULL,
      imagery_longitude REAL NOT NULL,
      imagery_heading REAL,
      imagery_field_of_view REAL,
      imagery_projection TEXT,
      imagery_url TEXT NOT NULL,
      priority_weight INTEGER,
      sponsored_until TEXT,
      verified INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dispensary_candidates (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      street_address TEXT,
      city TEXT,
      region TEXT,
      postal_code TEXT,
      country TEXT,
      latitude REAL,
      longitude REAL,
      website TEXT,
      phone TEXT,
      license_number TEXT,
      license_status TEXT,
      license_type TEXT,
      data_source TEXT NOT NULL,
      source_url TEXT,
      source_license TEXT,
      status TEXT NOT NULL DEFAULT 'candidate',
      imagery_status TEXT NOT NULL DEFAULT 'unchecked',
      imagery_count INTEGER,
      imagery_checked_at TEXT,
      imagery_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS map_locations (
      id TEXT PRIMARY KEY,
      dispensary_id TEXT,
      candidate_id TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      heading REAL,
      pitch REAL,
      difficulty TEXT NOT NULL DEFAULT 'normal',
      playable INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(dispensary_id) REFERENCES dispensaries(id) ON DELETE CASCADE,
      FOREIGN KEY(candidate_id) REFERENCES dispensary_candidates(id) ON DELETE CASCADE,
      CHECK(dispensary_id IS NOT NULL OR candidate_id IS NOT NULL)
    );

    CREATE TABLE IF NOT EXISTS imagery_assets (
      id TEXT PRIMARY KEY,
      dispensary_id TEXT,
      candidate_id TEXT,
      provider TEXT NOT NULL,
      external_photo_id TEXT,
      external_sequence_id TEXT,
      image_url TEXT NOT NULL,
      local_path TEXT,
      projection TEXT,
      field_of_view REAL,
      latitude REAL,
      longitude REAL,
      heading REAL,
      sequence_index INTEGER,
      width INTEGER,
      height INTEGER,
      checksum TEXT,
      license_text TEXT,
      attribution TEXT,
      approved INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(dispensary_id) REFERENCES dispensaries(id) ON DELETE CASCADE,
      FOREIGN KEY(candidate_id) REFERENCES dispensary_candidates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      mode TEXT NOT NULL DEFAULT 'standard',
      daily_key TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      total_score INTEGER NOT NULL DEFAULT 0,
      reward_atomic INTEGER NOT NULL DEFAULT 0,
      reward_status TEXT NOT NULL DEFAULT 'not_eligible',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      expires_at TEXT,
      client_version TEXT,
      ip_hash TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS game_rounds (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      dispensary_id TEXT NOT NULL,
      imagery_asset_id TEXT,
      round_number INTEGER NOT NULL,
      round_token_hash TEXT,
      guess_latitude REAL,
      guess_longitude REAL,
      distance_km REAL,
      score INTEGER,
      started_at TEXT NOT NULL,
      guessed_at TEXT,
      completed_at TEXT,
      FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY(dispensary_id) REFERENCES dispensaries(id) ON DELETE RESTRICT,
      FOREIGN KEY(imagery_asset_id) REFERENCES imagery_assets(id) ON DELETE SET NULL,
      UNIQUE(game_id, round_number)
    );

    CREATE TABLE IF NOT EXISTS reward_claims (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      game_id TEXT NOT NULL UNIQUE,
      wallet_id TEXT NOT NULL,
      amount_atomic INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      ledger_id TEXT,
      hold_reason TEXT,
      reviewed_by_admin_id TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY(wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
      FOREIGN KEY(ledger_id) REFERENCES wallet_ledger(id) ON DELETE SET NULL,
      FOREIGN KEY(reviewed_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sponsorships (
      id TEXT PRIMARY KEY,
      dispensary_id TEXT NOT NULL,
      payer_user_id TEXT,
      payer_address TEXT,
      amount_atomic INTEGER NOT NULL,
      payment_txid TEXT UNIQUE,
      priority_weight INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(dispensary_id) REFERENCES dispensaries(id) ON DELETE CASCADE,
      FOREIGN KEY(payer_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS daily_challenges (
      id TEXT PRIMARY KEY,
      challenge_date TEXT NOT NULL UNIQUE,
      seed_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_challenge_rounds (
      daily_challenge_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      dispensary_id TEXT NOT NULL,
      imagery_asset_id TEXT,
      PRIMARY KEY(daily_challenge_id, round_number),
      FOREIGN KEY(daily_challenge_id) REFERENCES daily_challenges(id) ON DELETE CASCADE,
      FOREIGN KEY(dispensary_id) REFERENCES dispensaries(id) ON DELETE RESTRICT,
      FOREIGN KEY(imagery_asset_id) REFERENCES imagery_assets(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS leaderboard_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      game_id TEXT NOT NULL UNIQUE,
      board_type TEXT NOT NULL,
      board_key TEXT NOT NULL,
      score INTEGER NOT NULL,
      rank_cache INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL,
      dispensary_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, dispensary_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(dispensary_id) REFERENCES dispensaries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      data_json TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      ip_hash TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rpc_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      available_at TEXT NOT NULL,
      locked_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions(admin_user_id, expires_at);
    CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS users_yerbas_idx ON users(yerbas_address);
    CREATE INDEX IF NOT EXISTS wallet_ledger_wallet_idx ON wallet_ledger(wallet_id, status, created_at);
    CREATE INDEX IF NOT EXISTS wallet_ledger_ref_idx ON wallet_ledger(reference_type, reference_id);
    CREATE INDEX IF NOT EXISTS deposits_wallet_idx ON deposits(wallet_id, status);
    CREATE INDEX IF NOT EXISTS withdrawals_wallet_idx ON withdrawals(wallet_id, status, requested_at);
    CREATE INDEX IF NOT EXISTS dispensaries_active_idx ON dispensaries(active, verified);
    CREATE INDEX IF NOT EXISTS dispensaries_region_idx ON dispensaries(region, city);
    CREATE INDEX IF NOT EXISTS dispensaries_source_idx ON dispensaries(data_source);
    CREATE INDEX IF NOT EXISTS candidate_status_idx ON dispensary_candidates(status, imagery_status);
    CREATE INDEX IF NOT EXISTS candidate_region_idx ON dispensary_candidates(region, city);
    CREATE INDEX IF NOT EXISTS candidate_license_idx ON dispensary_candidates(license_number);
    CREATE INDEX IF NOT EXISTS map_locations_playable_idx ON map_locations(playable, difficulty);
    CREATE INDEX IF NOT EXISTS imagery_assets_disp_idx ON imagery_assets(dispensary_id, approved, active);
    CREATE INDEX IF NOT EXISTS imagery_assets_external_idx ON imagery_assets(provider, external_photo_id);
    CREATE INDEX IF NOT EXISTS games_user_idx ON games(user_id, started_at);
    CREATE INDEX IF NOT EXISTS games_status_idx ON games(status, expires_at);
    CREATE INDEX IF NOT EXISTS rounds_game_idx ON game_rounds(game_id, round_number);
    CREATE INDEX IF NOT EXISTS rewards_status_idx ON reward_claims(status, created_at);
    CREATE INDEX IF NOT EXISTS sponsorships_active_idx ON sponsorships(status, starts_at, ends_at);
    CREATE INDEX IF NOT EXISTS leaderboard_board_idx ON leaderboard_entries(board_type, board_key, score DESC);
    CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read_at, created_at);
    CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_log(entity_type, entity_id, created_at);
    CREATE INDEX IF NOT EXISTS rpc_jobs_ready_idx ON rpc_jobs(status, available_at);
  `);

  const additiveColumns = [
    ['dispensaries', 'postal_code', 'TEXT'],
    ['dispensaries', 'phone', 'TEXT'],
    ['dispensaries', 'license_number', 'TEXT'],
    ['dispensary_candidates', 'postal_code', 'TEXT'],
    ['dispensary_candidates', 'phone', 'TEXT'],
    ['dispensary_candidates', 'license_status', 'TEXT'],
    ['dispensary_candidates', 'license_type', 'TEXT'],
  ] as const;

  for (const [table, column, definition] of additiveColumns) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`); } catch { /* column already exists */ }
  }

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations(version, name, applied_at)
    VALUES(1, 'initial application schema', ?)
  `).run(new Date().toISOString());
}

export function getDatabase() {
  if (database) return database;

  mkdirSync(runtimeDir, { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec('PRAGMA synchronous = NORMAL;');
  initializeSchema(database);
  return database;
}

export function getDatabasePath() {
  return databasePath;
}
