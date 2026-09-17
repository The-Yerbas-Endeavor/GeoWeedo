import 'server-only';

import { createHash } from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoCoreSchema, listUnknownScanGroups } from './weedoCore';
import { ensureWeedoFactsUploadSchema } from './weedoFactsUploads';

export type AdminIssueCategory =
  | 'coa_parse_failures'
  | 'pending_coa_reviews'
  | 'unknown_scans'
  | 'unmatched_menu_products'
  | 'low_confidence_matches'
  | 'stale_menus'
  | 'missing_coordinates'
  | 'failed_imagery';

export type AdminIssueSample = {
  id: string;
  title: string;
  detail: string;
  updatedAt: string | null;
  href?: string | null;
  resolvable?: boolean;
};

export type AdminIssueGroup = {
  category: AdminIssueCategory;
  label: string;
  description: string;
  count: number;
  href: string;
  samples: AdminIssueSample[];
};

function tableExists(table: string) {
  return Boolean(getDatabase().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").get(table));
}

function ensureIssueEventSchema() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_issue_events (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      message TEXT,
      details_json TEXT,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS admin_issue_events_open_idx
      ON admin_issue_events(category,resolved_at,last_seen_at DESC);
  `);
  return db;
}

export function recordAdminIssueEvent(input: {
  category: string;
  fingerprint: string;
  title: string;
  message?: string | null;
  details?: unknown;
}) {
  const db = ensureIssueEventSchema();
  const now = new Date().toISOString();
  const fingerprint = createHash('sha256').update(input.fingerprint).digest('hex');
  const id = `issue-${fingerprint.slice(0, 24)}`;
  const details = input.details === undefined ? null : JSON.stringify(input.details);
  db.prepare(`
    INSERT INTO admin_issue_events
      (id,category,fingerprint,title,message,details_json,occurrence_count,first_seen_at,last_seen_at,resolved_at)
    VALUES (?,?,?,?,?,?,1,?,?,NULL)
    ON CONFLICT(fingerprint) DO UPDATE SET
      category=excluded.category,
      title=excluded.title,
      message=excluded.message,
      details_json=excluded.details_json,
      occurrence_count=CASE WHEN admin_issue_events.resolved_at IS NULL THEN admin_issue_events.occurrence_count+1 ELSE 1 END,
      first_seen_at=CASE WHEN admin_issue_events.resolved_at IS NULL THEN admin_issue_events.first_seen_at ELSE excluded.first_seen_at END,
      last_seen_at=excluded.last_seen_at,
      resolved_at=NULL
  `).run(id, input.category, fingerprint, input.title, input.message || null, details, now, now);
  return id;
}

export function resolveAdminIssueEvent(id: string) {
  const result = ensureIssueEventSchema().prepare(`
    UPDATE admin_issue_events SET resolved_at=? WHERE id=? AND resolved_at IS NULL
  `).run(new Date().toISOString(), id);
  return Number(result.changes || 0) > 0;
}

function rows<T = any>(sql: string, ...params: any[]): T[] {
  return getDatabase().prepare(sql).all(...params) as T[];
}

function count(sql: string, ...params: any[]) {
  const row = getDatabase().prepare(sql).get(...params) as any;
  return Number(row?.count || 0);
}

function clean(value: unknown, fallback = 'Unknown') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function parseFailureGroup(): AdminIssueGroup {
  const failures = rows<any>(`
    SELECT id,title,message,last_seen_at,occurrence_count
    FROM admin_issue_events
    WHERE category='coa_parse_failure' AND resolved_at IS NULL
    ORDER BY last_seen_at DESC LIMIT 6
  `);
  const failureCount = count(`
    SELECT COALESCE(SUM(occurrence_count),0) AS count
    FROM admin_issue_events
    WHERE category='coa_parse_failure' AND resolved_at IS NULL
  `);
  return {
    category: 'coa_parse_failures',
    label: 'COA parse failures',
    description: 'Uploaded COAs that the parser could not understand. Repeated failures are grouped automatically.',
    count: failureCount,
    href: '/admin/issues?category=coa_parse_failures',
    samples: failures.map(row => ({
      id: String(row.id),
      title: clean(row.title, 'COA parser failure'),
      detail: `${clean(row.message, 'Parser error')} · ${Number(row.occurrence_count || 1)} occurrence${Number(row.occurrence_count || 1) === 1 ? '' : 's'}`,
      updatedAt: row.last_seen_at || null,
      resolvable: true,
    })),
  };
}

export function getAdminIssuesDashboard(staleHours = 24) {
  ensureWeedoCoreSchema();
  ensureWeedoFactsUploadSchema();
  ensureIssueEventSchema();
  const staleWindow = Math.max(1, staleHours);
  const staleCutoff = new Date(Date.now() - staleWindow * 60 * 60 * 1000).toISOString();

  const unknownGroups = listUnknownScanGroups(100);
  const unknownCount = unknownGroups.reduce((sum, row) => sum + Number(row.unique_payloads || 0), 0);

  const pendingCoaCount = tableExists('cannabis_coa_uploads') ? count(`
    SELECT COUNT(*) AS count
    FROM cannabis_coa_uploads u
    LEFT JOIN cannabis_product_submissions s ON s.id=u.submission_id
    WHERE u.status='submitted' AND (s.status IS NULL OR s.status IN ('pending','needs_info'))
  `) : 0;
  const pendingCoas = pendingCoaCount ? rows<any>(`
    SELECT u.id,u.original_filename,u.updated_at,s.brand_name,s.product_name,s.status
    FROM cannabis_coa_uploads u
    LEFT JOIN cannabis_product_submissions s ON s.id=u.submission_id
    WHERE u.status='submitted' AND (s.status IS NULL OR s.status IN ('pending','needs_info'))
    ORDER BY u.updated_at DESC LIMIT 6
  `) : [];

  const unmatchedCount = tableExists('dispensary_menu_items') ? count(`
    SELECT COUNT(*) AS count
    FROM dispensary_menu_items mi JOIN dispensary_menus m ON m.id=mi.menu_id
    WHERE mi.active=1 AND m.active=1 AND mi.product_id IS NULL
  `) : 0;
  const unmatched = unmatchedCount ? rows<any>(`
    SELECT mi.id,mi.item_name,mi.brand_name,mi.updated_at,d.name AS dispensary_name
    FROM dispensary_menu_items mi
    JOIN dispensary_menus m ON m.id=mi.menu_id
    JOIN dispensaries d ON d.id=m.dispensary_id
    WHERE mi.active=1 AND m.active=1 AND mi.product_id IS NULL
    ORDER BY mi.updated_at DESC LIMIT 6
  `) : [];

  const possibleCount = tableExists('dispensary_menu_items')
    ? count(`SELECT COUNT(*) AS count FROM dispensary_menu_items WHERE active=1 AND match_confidence='possible'`)
    : 0;
  const possible = possibleCount ? rows<any>(`
    SELECT mi.id,mi.item_name,mi.brand_name,mi.match_score,mi.match_reason,mi.matched_at,d.name AS dispensary_name
    FROM dispensary_menu_items mi
    JOIN dispensary_menus m ON m.id=mi.menu_id
    JOIN dispensaries d ON d.id=m.dispensary_id
    WHERE mi.active=1 AND m.active=1 AND mi.match_confidence='possible'
    ORDER BY COALESCE(mi.matched_at,mi.updated_at) DESC LIMIT 6
  `) : [];

  // Raw imported candidates with no coordinates are an automated data backlog,
  // not thousands of individual operator tasks. Only records already promoted
  // into review/approval should interrupt the Issues queue.
  const missingCoordinateCount = tableExists('dispensary_candidates') ? count(`
    SELECT COUNT(*) AS count FROM dispensary_candidates
    WHERE status IN ('reviewing','approved') AND (latitude IS NULL OR longitude IS NULL)
  `) : 0;
  const missingCoordinates = missingCoordinateCount ? rows<any>(`
    SELECT id,name,city,region,updated_at FROM dispensary_candidates
    WHERE status IN ('reviewing','approved') AND (latitude IS NULL OR longitude IS NULL)
    ORDER BY updated_at DESC LIMIT 6
  `) : [];

  // No imagery coverage is a valid terminal validation result. Only actual
  // provider/processing errors need operator attention here.
  const failedImageryCount = tableExists('dispensary_candidates') ? count(`
    SELECT COUNT(*) AS count FROM dispensary_candidates
    WHERE status!='rejected' AND imagery_status='error'
  `) : 0;
  const failedImagery = failedImageryCount ? rows<any>(`
    SELECT id,name,city,region,imagery_status,imagery_message,imagery_checked_at,updated_at
    FROM dispensary_candidates
    WHERE status!='rejected' AND imagery_status='error'
    ORDER BY COALESCE(imagery_checked_at,updated_at) DESC LIMIT 6
  `) : [];

  const staleWhere = `
    FROM dispensary_menu_items mi
    JOIN dispensary_menus m ON m.id=mi.menu_id
    JOIN dispensaries d ON d.id=m.dispensary_id
    WHERE mi.active=1 AND m.active=1 AND d.active=1
      AND LOWER(COALESCE(mi.source_type,m.source_type,'manual')) NOT IN (
        'manual','community','business-supplied','business_supplied','verified_owner_scan','owner_reported_scan'
      )
      AND COALESCE(mi.source_updated_at,mi.updated_at) < ?
  `;
  const staleMenuCount = tableExists('dispensary_menu_items')
    ? count(`SELECT COUNT(DISTINCT d.id) AS count ${staleWhere}`, staleCutoff)
    : 0;
  const staleMenus = staleMenuCount ? rows<any>(`
    SELECT d.id,d.name,COUNT(*) AS stale_items,
           MAX(COALESCE(mi.source_updated_at,mi.updated_at)) AS last_observed
    ${staleWhere}
    GROUP BY d.id,d.name
    ORDER BY last_observed ASC LIMIT 6
  `, staleCutoff) : [];

  const groups: AdminIssueGroup[] = [
    parseFailureGroup(),
    {
      category: 'pending_coa_reviews', label: 'COAs awaiting review', count: pendingCoaCount,
      description: 'Submitted COA evidence that still needs an approval, rejection, or more information.', href: '/admin/weedo-facts',
      samples: pendingCoas.map(row => ({ id: String(row.id), title: [row.brand_name,row.product_name].filter(Boolean).join(' — ') || clean(row.original_filename,'Submitted COA'), detail: `Review status: ${clean(row.status,'pending')}`, updatedAt: row.updated_at || null, href: '/admin/weedo-facts' })),
    },
    {
      category: 'unknown_scans', label: 'Unknown scans', count: unknownCount,
      description: 'QR, UPC, lab, or identifier formats GeoWeedo has seen but cannot resolve yet.', href: '/admin/issues?category=unknown_scans',
      samples: unknownGroups.slice(0,6).map((row,index) => ({ id: `unknown-${index}-${row.payload_kind}-${row.qr_host}`, title: clean(row.qr_host,clean(row.payload_kind,'Unknown scan')), detail: `${Number(row.unique_payloads||0)} unique payload${Number(row.unique_payloads||0)===1?'':'s'} · ${Number(row.scan_count||0)} scan${Number(row.scan_count||0)===1?'':'s'} · ${clean(row.resolver,'generic resolver')}`, updatedAt: row.last_seen_at || null })),
    },
    {
      category: 'unmatched_menu_products', label: 'Unmatched menu products', count: unmatchedCount,
      description: 'Active dispensary menu listings that are not connected to a canonical GeoWeedo product.', href: '/admin/products-menus',
      samples: unmatched.map(row => ({ id:String(row.id), title:[row.brand_name,row.item_name].filter(Boolean).join(' — ')||clean(row.item_name), detail:clean(row.dispensary_name,'Unknown dispensary'), updatedAt:row.updated_at||null, href:'/admin/products-menus' })),
    },
    {
      category: 'low_confidence_matches', label: 'Low-confidence matches', count: possibleCount,
      description: 'Menu listings with only a possible product match. They should not be presented as exact availability.', href: '/admin/products-menus',
      samples: possible.map(row => ({ id:String(row.id), title:[row.brand_name,row.item_name].filter(Boolean).join(' — ')||clean(row.item_name), detail:`${clean(row.dispensary_name,'Unknown dispensary')} · score ${Math.round(Number(row.match_score||0))}${row.match_reason?` · ${row.match_reason}`:''}`, updatedAt:row.matched_at||null, href:'/admin/products-menus' })),
    },
    {
      category: 'stale_menus', label: 'Stale imported menus', count: staleMenuCount,
      description: `Imported/feed menu data with no refresh in the last ${staleWindow} hours. Manual and verified-owner listings are excluded.`, href: '/admin/products-menus',
      samples: staleMenus.map(row => ({ id:String(row.id), title:clean(row.name,'Dispensary'), detail:`${Number(row.stale_items||0)} stale listing${Number(row.stale_items||0)===1?'':'s'}`, updatedAt:row.last_observed||null, href:'/admin/products-menus' })),
    },
    {
      category: 'missing_coordinates', label: 'Missing coordinates', count: missingCoordinateCount,
      description: 'Reviewing or approved dispensary candidates that cannot move forward until coordinates are available. Raw import backlog stays in Data Import.', href: '/admin/data',
      samples: missingCoordinates.map(row => ({ id:String(row.id), title:clean(row.name,'Dispensary candidate'), detail:[row.city,row.region].filter(Boolean).join(', ')||'Location incomplete', updatedAt:row.updated_at||null, href:'/admin/data' })),
    },
    {
      category: 'failed_imagery', label: 'Imagery errors', count: failedImageryCount,
      description: 'Candidates where imagery validation encountered an actual provider or processing error. Normal no-coverage results are excluded.', href: '/admin/gameplay-pipeline',
      samples: failedImagery.map(row => ({ id:String(row.id), title:clean(row.name,'Dispensary candidate'), detail:`${clean(row.imagery_status,'imagery issue').replace(/_/g,' ')}${row.imagery_message?` · ${row.imagery_message}`:''}`, updatedAt:row.imagery_checked_at||row.updated_at||null, href:'/admin/gameplay-pipeline' })),
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    staleHours: staleWindow,
    total: groups.reduce((sum, group) => sum + group.count, 0),
    activeGroups: groups.filter(group => group.count > 0).length,
    groups,
  };
}
