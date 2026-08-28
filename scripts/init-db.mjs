import { getDatabase, getDatabasePath } from '../lib/sqlite.ts';

const db = getDatabase();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const migration = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1').get();

console.log(`GeoWeedo SQLite initialized: ${getDatabasePath()}`);
console.log(`Tables: ${tables.length}`);
if (migration) console.log(`Schema: v${migration.version} ${migration.name}`);
