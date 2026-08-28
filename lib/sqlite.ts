import 'server-only';

import { mkdirSync } from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const runtimeDir = path.join(process.cwd(), 'data', 'runtime');
const databasePath = path.join(runtimeDir, 'geoweedo.sqlite');

let database: DatabaseSync | null = null;

export function getDatabase() {
  if (database) return database;

  mkdirSync(runtimeDir, { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS dispensaries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      street_address TEXT,
      city TEXT NOT NULL,
      region TEXT NOT NULL,
      country TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      website TEXT,
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
      country TEXT,
      latitude REAL,
      longitude REAL,
      website TEXT,
      license_number TEXT,
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

    CREATE INDEX IF NOT EXISTS dispensaries_active_idx ON dispensaries(active, verified);
    CREATE INDEX IF NOT EXISTS dispensaries_region_idx ON dispensaries(region, city);
    CREATE INDEX IF NOT EXISTS dispensaries_source_idx ON dispensaries(data_source);
    CREATE INDEX IF NOT EXISTS candidate_status_idx ON dispensary_candidates(status, imagery_status);
    CREATE INDEX IF NOT EXISTS candidate_region_idx ON dispensary_candidates(region, city);
    CREATE INDEX IF NOT EXISTS candidate_license_idx ON dispensary_candidates(license_number);
  `);

  return database;
}

export function getDatabasePath() {
  return databasePath;
}
