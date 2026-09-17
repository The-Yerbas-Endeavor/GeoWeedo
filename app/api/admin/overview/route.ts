import { NextRequest, NextResponse } from 'next/server';
import { adminHasPermission, getAdminFromRequest } from '@/lib/adminAuth';
import { getAnalyticsDb } from '@/lib/analytics';
import { getDatabase } from '@/lib/sqlite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const HUMAN_SQL = `LOWER(COALESCE(s.user_agent,'')) NOT LIKE '%bot%' AND LOWER(COALESCE(s.user_agent,'')) NOT LIKE '%crawler%' AND LOWER(COALESCE(s.user_agent,'')) NOT LIKE '%spider%' AND LOWER(COALESCE(s.user_agent,'')) NOT LIKE '%headless%' AND LOWER(COALESCE(s.user_agent,'')) NOT LIKE '%wget%' AND LOWER(COALESCE(s.user_agent,'')) NOT LIKE '%curl/%' AND LOWER(COALESCE(s.user_agent,'')) NOT LIKE '%python-requests%' AND LOWER(COALESCE(s.user_agent,'')) NOT LIKE '%go-http-client%'`;

type Db = ReturnType<typeof getDatabase>;

function tableExists(db: Db, name: string) {
  return Boolean(db.prepare(`SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`).get(name));
}

function scalar(db: any, sql: string, ...params: any[]) {
  try { return Number((db.prepare(sql).get(...params) as any)?.value || 0); }
  catch { return 0; }
}

function analyticsSummary() {
  const db = getAnalyticsDb();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const activeSince = new Date(Date.now() - 10 * 60000).toISOString();
  const nonAdminSession = `EXISTS (SELECT 1 FROM analytics_events ae WHERE ae.session_id=s.id AND ae.event_type='page_view' AND COALESCE(ae.path,'/') NOT LIKE '/admin%')`;
  return {
    days: 7,
    activeNow: scalar(db, `SELECT COUNT(DISTINCT s.visitor_id) value FROM analytics_sessions s WHERE s.last_seen_at>=? AND ${HUMAN_SQL} AND ${nonAdminSession}`, activeSince),
    visitors: scalar(db, `SELECT COUNT(DISTINCT s.visitor_id) value FROM analytics_sessions s WHERE s.started_at>=? AND ${HUMAN_SQL} AND ${nonAdminSession}`, since),
    sessions: scalar(db, `SELECT COUNT(*) value FROM analytics_sessions s WHERE s.started_at>=? AND ${HUMAN_SQL} AND ${nonAdminSession}`, since),
    pageViews: scalar(db, `SELECT COUNT(*) value FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id WHERE e.event_type='page_view' AND e.created_at>=? AND COALESCE(e.path,'/') NOT LIKE '/admin%' AND ${HUMAN_SQL}`, since),
  };
}

function scanSummary(db: Db) {
  if (!tableExists(db, 'cannabis_qr_scans')) return null;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const products = tableExists(db, 'cannabis_products') ? scalar(db, `SELECT COUNT(*) value FROM cannabis_products`) : 0;
  const recent = tableExists(db, 'cannabis_products')
    ? db.prepare(`SELECT q.id,q.qr_value,q.qr_host,q.resolver,q.last_seen_at,q.scan_count,q.product_id,q.batch_id,q.title,q.brand_name,q.product_name,p.brand_name canonical_brand_name,p.product_name canonical_product_name FROM cannabis_qr_scans q LEFT JOIN cannabis_products p ON p.id=q.product_id ORDER BY q.last_seen_at DESC,q.first_seen_at DESC LIMIT 5`).all() as any[]
    : db.prepare(`SELECT id,qr_value,qr_host,resolver,last_seen_at,scan_count,product_id,batch_id,title,brand_name,product_name FROM cannabis_qr_scans ORDER BY last_seen_at DESC,first_seen_at DESC LIMIT 5`).all() as any[];
  return {
    products,
    qrCodes: scalar(db, `SELECT COUNT(*) value FROM cannabis_qr_scans`),
    scanEvents: scalar(db, `SELECT COALESCE(SUM(scan_count),0) value FROM cannabis_qr_scans`),
    recentQrCodes: scalar(db, `SELECT COUNT(*) value FROM cannabis_qr_scans WHERE last_seen_at>=?`, since),
    unlinkedQrCodes: scalar(db, `SELECT COUNT(*) value FROM cannabis_qr_scans WHERE product_id IS NULL OR batch_id IS NULL`),
    recent: recent.map(row => ({
      id: String(row.id),
      name: String(row.canonical_product_name || row.product_name || row.title || row.qr_host || row.resolver || 'Unknown scan'),
      brand: String(row.canonical_brand_name || row.brand_name || ''),
      source: String(row.qr_host || row.resolver || ''),
      linked: Boolean(row.product_id && row.batch_id),
      scans: Number(row.scan_count || 0),
      lastSeenAt: String(row.last_seen_at || ''),
    })),
  };
}

function userSummary(db: Db) {
  if (!tableExists(db, 'users')) return null;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const recent = db.prepare(`SELECT id,username,display_name,created_at,last_login_at FROM users ORDER BY created_at DESC LIMIT 5`).all() as any[];
  return {
    total: scalar(db, `SELECT COUNT(*) value FROM users`),
    newUsers: scalar(db, `SELECT COUNT(*) value FROM users WHERE created_at>=?`, since),
    activeUsers: scalar(db, `SELECT COUNT(*) value FROM users WHERE last_login_at>=?`, since),
    suspended: scalar(db, `SELECT COUNT(*) value FROM users WHERE account_status='suspended'`),
    recent: recent.map(row => ({
      id: String(row.id),
      name: String(row.display_name || row.username || 'GeoWeedo user'),
      createdAt: String(row.created_at || ''),
      lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    })),
  };
}

function dispensarySummary(db: Db, includeSponsorships: boolean) {
  if (!tableExists(db, 'dispensaries')) return null;
  const now = new Date().toISOString();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const recent = db.prepare(`SELECT id,name,city,region,active,imagery_provider,updated_at FROM dispensaries ORDER BY updated_at DESC LIMIT 5`).all() as any[];
  const storesWithMenus = tableExists(db, 'dispensary_menus') && tableExists(db, 'dispensary_menu_items')
    ? scalar(db, `SELECT COUNT(DISTINCT m.dispensary_id) value FROM dispensary_menus m JOIN dispensary_menu_items mi ON mi.menu_id=m.id WHERE m.active=1 AND mi.active=1`)
    : 0;
  let activeFeatured = 0, activeCampaigns = 0, sponsorEvents = 0;
  if (includeSponsorships) {
    if (tableExists(db, 'sponsor_entitlements')) activeFeatured = scalar(db, `SELECT COUNT(DISTINCT dispensary_id) value FROM sponsor_entitlements WHERE entitlement_type='featured_listing' AND status='active' AND starts_at<=? AND ends_at>?`, now, now);
    if (tableExists(db, 'sponsor_game_campaigns')) activeCampaigns = scalar(db, `SELECT COUNT(*) value FROM sponsor_game_campaigns WHERE status='active' AND starts_at<=? AND ends_at>?`, now, now);
    if (tableExists(db, 'sponsor_events')) sponsorEvents = scalar(db, `SELECT COUNT(*) value FROM sponsor_events WHERE created_at>=?`, since);
  }
  return {
    total: scalar(db, `SELECT COUNT(*) value FROM dispensaries`),
    active: scalar(db, `SELECT COUNT(*) value FROM dispensaries WHERE active=1`),
    playable: scalar(db, `SELECT COUNT(*) value FROM dispensaries WHERE active=1 AND latitude IS NOT NULL AND longitude IS NOT NULL AND COALESCE(imagery_provider,'')<>''`),
    storesWithMenus,
    activeFeatured,
    activeCampaigns,
    sponsorEvents,
    sponsorshipVisible: includeSponsorships,
    recent: recent.map(row => ({
      id: String(row.id),
      name: String(row.name),
      location: [row.city, row.region].filter(Boolean).join(', '),
      active: Number(row.active) === 1,
      playable: Number(row.active) === 1 && Boolean(row.imagery_provider),
      updatedAt: String(row.updated_at || ''),
    })),
  };
}

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: NO_STORE });
  const db = getDatabase();
  const verifiedOwner = admin.role === 'verified_dispensary';
  return NextResponse.json({
    admin: { username: admin.username, displayName: admin.displayName, role: admin.role, permissions: admin.permissions },
    analytics: verifiedOwner ? null : analyticsSummary(),
    scans: adminHasPermission(admin, 'data.manage') ? scanSummary(db) : null,
    users: adminHasPermission(admin, 'users.view') ? userSummary(db) : null,
    dispensaries: adminHasPermission(admin, 'locations.view') ? dispensarySummary(db, adminHasPermission(admin, 'sponsorships.manage')) : null,
  }, { headers: NO_STORE });
}
