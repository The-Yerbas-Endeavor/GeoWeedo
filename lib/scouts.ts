import 'server-only';

import { getDatabase } from '@/lib/sqlite';

let ready=false;

export function ensureScoutSchema(){
  if(ready)return;
  const db=getDatabase();
  const cols=(db.prepare("PRAGMA table_info(users)").all() as any[]).map(row=>String(row.name));
  if(!cols.includes('scout_enabled'))db.exec("ALTER TABLE users ADD COLUMN scout_enabled INTEGER NOT NULL DEFAULT 0");
  if(!cols.includes('scout_status'))db.exec("ALTER TABLE users ADD COLUMN scout_status TEXT NOT NULL DEFAULT 'inactive'");
  if(!cols.includes('scout_since'))db.exec("ALTER TABLE users ADD COLUMN scout_since TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS scout_contributions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      contribution_type TEXT NOT NULL,
      source_id TEXT,
      product_id TEXT,
      batch_id TEXT,
      dispensary_id TEXT,
      status TEXT NOT NULL DEFAULT 'accepted',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS scout_contributions_source_idx ON scout_contributions(contribution_type,source_id);
    CREATE INDEX IF NOT EXISTS scout_contributions_user_idx ON scout_contributions(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS scout_contributions_status_idx ON scout_contributions(status,created_at DESC);
  `);
  ready=true;
}

export function syncScoutAvailabilityContributions(){
  ensureScoutSchema();
  const db=getDatabase();
  const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_availability_observations'").get();
  if(!exists)return;
  const now=new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO scout_contributions
      (id,user_id,contribution_type,source_id,product_id,batch_id,dispensary_id,status,created_at,updated_at)
    SELECT 'scout-'||o.id,o.reported_by_user_id,
      CASE WHEN o.source_type='scanner' THEN 'package_scan' ELSE 'dispensary_sighting' END,
      o.id,o.product_id,o.batch_id,o.dispensary_id,'accepted',o.created_at,o.updated_at
    FROM product_availability_observations o
    JOIN users u ON u.id=o.reported_by_user_id
    WHERE o.reported_by_user_id IS NOT NULL AND o.source_type IN ('scanner','user')
      AND COALESCE(u.scout_enabled,0)=1
  `).run();
  db.prepare("UPDATE users SET scout_status='active', scout_since=COALESCE(scout_since,?), updated_at=updated_at WHERE scout_enabled=1 AND scout_status='inactive'").run(now);
}

export function listScouts(){
  syncScoutAvailabilityContributions();
  return (getDatabase().prepare(`
    SELECT u.id,u.username,u.display_name displayName,u.email,u.scout_enabled scoutEnabled,
      u.scout_status scoutStatus,u.scout_since scoutSince,u.last_login_at lastLoginAt,
      COUNT(c.id) contributions,
      SUM(CASE WHEN c.status='accepted' THEN 1 ELSE 0 END) accepted,
      SUM(CASE WHEN c.status='pending' THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN c.status='rejected' THEN 1 ELSE 0 END) rejected,
      MAX(c.created_at) lastContributionAt
    FROM users u LEFT JOIN scout_contributions c ON c.user_id=u.id
    WHERE COALESCE(u.scout_enabled,0)=1 OR EXISTS(SELECT 1 FROM scout_contributions x WHERE x.user_id=u.id)
    GROUP BY u.id ORDER BY COALESCE(MAX(c.created_at),u.scout_since,u.created_at) DESC
  `).all() as any[]).map(row=>({...row,scoutEnabled:Boolean(row.scoutEnabled),contributions:Number(row.contributions||0),accepted:Number(row.accepted||0),pending:Number(row.pending||0),rejected:Number(row.rejected||0)}));
}

export function scoutSummary(){
  syncScoutAvailabilityContributions();
  const db=getDatabase();
  const row=db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE scout_enabled=1) scouts,
      (SELECT COUNT(DISTINCT user_id) FROM scout_contributions WHERE created_at>=datetime('now','-7 days')) active7d,
      (SELECT COUNT(*) FROM scout_contributions) contributions,
      (SELECT COUNT(*) FROM scout_contributions WHERE status='pending') pending,
      (SELECT COUNT(*) FROM scout_contributions WHERE status='accepted') accepted,
      (SELECT COUNT(*) FROM scout_contributions WHERE status='rejected') rejected
  `).get() as any;
  return Object.fromEntries(Object.entries(row||{}).map(([k,v])=>[k,Number(v||0)]));
}
