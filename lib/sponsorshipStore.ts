import 'server-only';

import crypto from 'crypto';
import { getDatabase } from '@/lib/sqlite';

export type SponsorEventType =
  | 'pin_impression'
  | 'pin_click'
  | 'listing_view'
  | 'website_click'
  | 'menu_click'
  | 'directions_click'
  | 'game_impression'
  | 'game_completed';

export type FeaturedEntitlement = {
  id: string;
  dispensaryId: string;
  businessId: string;
  status: 'active' | 'expired' | 'cancelled';
  startsAt: string;
  endsAt: string;
  source: 'admin_comp' | 'manual_invoice' | 'subscription';
  planCode: string;
  currency: 'USD';
  createdAt: string;
  updatedAt: string;
};

export function ensureSponsorshipSchema() {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sponsor_businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      website TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS sponsor_business_locations (
      business_id TEXT NOT NULL,
      dispensary_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'verified',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(business_id, dispensary_id),
      FOREIGN KEY(business_id) REFERENCES sponsor_businesses(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sponsor_plans (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      monthly_price_cents INTEGER NOT NULL,
      annual_price_cents INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sponsor_subscriptions (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL,
      billing_interval TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      amount_cents INTEGER NOT NULL,
      provider TEXT,
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      starts_at TEXT NOT NULL,
      current_period_end TEXT NOT NULL,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(business_id) REFERENCES sponsor_businesses(id) ON DELETE CASCADE,
      FOREIGN KEY(plan_id) REFERENCES sponsor_plans(id)
    );
    CREATE TABLE IF NOT EXISTS sponsor_entitlements (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      dispensary_id TEXT NOT NULL,
      entitlement_type TEXT NOT NULL DEFAULT 'featured_listing',
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'admin_comp',
      plan_code TEXT NOT NULL DEFAULT 'featured',
      subscription_id TEXT,
      granted_by_admin_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(business_id) REFERENCES sponsor_businesses(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sponsor_payments (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      subscription_id TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      provider TEXT,
      provider_payment_id TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sponsor_events (
      id TEXT PRIMARY KEY,
      business_id TEXT,
      dispensary_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sponsor_entitlements_location_idx ON sponsor_entitlements(dispensary_id,status,starts_at,ends_at);
    CREATE INDEX IF NOT EXISTS sponsor_events_location_idx ON sponsor_events(dispensary_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS sponsor_events_business_idx ON sponsor_events(business_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS sponsor_requests (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      dispensary_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      request_type TEXT NOT NULL,
      billing_interval TEXT,
      game_type TEXT,
      duration_code TEXT,
      geography_type TEXT NOT NULL DEFAULT 'all',
      geography_value TEXT,
      radius_km REAL,
      preferred_start_at TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by_admin_id TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(business_id) REFERENCES sponsor_businesses(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS sponsor_requests_owner_idx ON sponsor_requests(owner_user_id,dispensary_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS sponsor_requests_status_idx ON sponsor_requests(status,created_at DESC);
  `);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sponsor_plans(id,code,name,currency,monthly_price_cents,annual_price_cents,active,created_at,updated_at)
    VALUES('plan-featured','featured','GeoWeedo Featured','USD',3900,39000,1,?,?)
    ON CONFLICT(code) DO UPDATE SET name=excluded.name,currency='USD',monthly_price_cents=excluded.monthly_price_cents,annual_price_cents=excluded.annual_price_cents,active=1,updated_at=excluded.updated_at`).run(now, now);
}

function businessForVerifiedOwner(userId: string, dispensaryId: string) {
  ensureSponsorshipSchema();
  const db = getDatabase();
  const verified = db.prepare(`SELECT 1 ok FROM dispensary_user_owner_assignments WHERE user_id=? AND location_id=? AND status='verified'`).get(userId, dispensaryId);
  if (!verified) return null;
  let business = db.prepare(`SELECT b.* FROM sponsor_businesses b JOIN sponsor_business_locations l ON l.business_id=b.id WHERE b.owner_user_id=? AND l.dispensary_id=? LIMIT 1`).get(userId, dispensaryId) as any;
  if (business) return business;
  const location = db.prepare('SELECT name,website FROM dispensaries WHERE id=?').get(dispensaryId) as any;
  if (!location) return null;
  const user = db.prepare('SELECT email FROM users WHERE id=?').get(userId) as any;
  const now = new Date().toISOString();
  const id = `business-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO sponsor_businesses(id,name,owner_user_id,contact_email,website,status,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?)`).run(id, String(location.name), userId, user?.email || null, location.website || null, now, now);
  db.prepare(`INSERT INTO sponsor_business_locations(business_id,dispensary_id,status,created_at,updated_at) VALUES(?,?,'verified',?,?)`).run(id, dispensaryId, now, now);
  return db.prepare('SELECT * FROM sponsor_businesses WHERE id=?').get(id) as any;
}

export function syncVerifiedOwnerBusiness(userId: string, dispensaryId: string) {
  return businessForVerifiedOwner(userId, dispensaryId);
}

export function expireEndedFeaturedEntitlements(now = new Date().toISOString()) {
  ensureSponsorshipSchema();
  const result = getDatabase().prepare(`
    UPDATE sponsor_entitlements
       SET status='expired',updated_at=?
     WHERE entitlement_type='featured_listing'
       AND status='active'
       AND ends_at<=?
  `).run(now, now);
  return Number(result.changes || 0);
}

export function listFeaturedEntitlements(): FeaturedEntitlement[] {
  ensureSponsorshipSchema();
  expireEndedFeaturedEntitlements();
  const rows = getDatabase().prepare(`SELECT * FROM sponsor_entitlements ORDER BY created_at DESC`).all() as any[];
  return rows.map((row) => ({
    id: String(row.id), businessId: String(row.business_id), dispensaryId: String(row.dispensary_id),
    status: row.status, startsAt: String(row.starts_at), endsAt: String(row.ends_at), source: row.source,
    planCode: String(row.plan_code || 'featured'), currency: 'USD', createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export function activeFeaturedMap() {
  ensureSponsorshipSchema();
  const now = new Date().toISOString();
  expireEndedFeaturedEntitlements(now);
  const rows = getDatabase().prepare(`SELECT * FROM sponsor_entitlements WHERE entitlement_type='featured_listing' AND status='active' AND starts_at<=? AND ends_at>? ORDER BY created_at DESC`).all(now, now) as any[];
  const map = new Map<string, any>();
  for (const row of rows) if (!map.has(String(row.dispensary_id))) map.set(String(row.dispensary_id), row);
  return map;
}

export async function activeSponsorshipMap() {
  return activeFeaturedMap();
}

export function grantFeatured(input: { dispensaryId: string; businessId?: string; ownerUserId?: string; startsAt: string; endsAt: string; status?: 'active'|'expired'|'cancelled'; source?: 'admin_comp'|'manual_invoice'|'subscription'; adminId?: string }) {
  ensureSponsorshipSchema();
  const db = getDatabase();
  const location = db.prepare('SELECT id,name FROM dispensaries WHERE id=?').get(input.dispensaryId) as any;
  if (!location) throw new Error('Dispensary not found.');
  let businessId = input.businessId;
  if (!businessId && input.ownerUserId) businessId = businessForVerifiedOwner(input.ownerUserId, input.dispensaryId)?.id;
  if (!businessId) {
    const now = new Date().toISOString();
    businessId = `business-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO sponsor_businesses(id,name,status,created_at,updated_at) VALUES(?,?,'active',?,?)`).run(businessId, String(location.name), now, now);
    db.prepare(`INSERT OR IGNORE INTO sponsor_business_locations(business_id,dispensary_id,status,created_at,updated_at) VALUES(?,?,'verified',?,?)`).run(businessId, input.dispensaryId, now, now);
  }
  if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) throw new Error('Featured end date must be after the start date.');
  const now = new Date().toISOString();
  const existing = db.prepare(`SELECT id,created_at FROM sponsor_entitlements WHERE dispensary_id=? AND entitlement_type='featured_listing' ORDER BY created_at DESC LIMIT 1`).get(input.dispensaryId) as any;
  const id = existing?.id || `featured-${crypto.randomUUID()}`;
  if (existing) {
    db.prepare(`UPDATE sponsor_entitlements SET business_id=?,status=?,starts_at=?,ends_at=?,source=?,plan_code='featured',granted_by_admin_id=?,updated_at=? WHERE id=?`).run(businessId, input.status || 'active', input.startsAt, input.endsAt, input.source || 'admin_comp', input.adminId || null, now, id);
  } else {
    db.prepare(`INSERT INTO sponsor_entitlements(id,business_id,dispensary_id,entitlement_type,status,starts_at,ends_at,source,plan_code,granted_by_admin_id,created_at,updated_at) VALUES(?,?,?,'featured_listing',?,?,?,?, 'featured',?,?,?)`).run(id, businessId, input.dispensaryId, input.status || 'active', input.startsAt, input.endsAt, input.source || 'admin_comp', input.adminId || null, now, now);
  }
  return listFeaturedEntitlements().find((item) => item.id === id)!;
}

export function recordSponsorEvent(dispensaryId: string, eventType: SponsorEventType, metadata?: Record<string, unknown>) {
  ensureSponsorshipSchema();
  const featured = activeFeaturedMap().get(dispensaryId);
  if (!featured) return false;
  getDatabase().prepare(`INSERT INTO sponsor_events(id,business_id,dispensary_id,event_type,metadata_json,created_at) VALUES(?,?,?,?,?,?)`).run(
    `se-${crypto.randomUUID()}`, featured.business_id || null, dispensaryId, eventType, metadata ? JSON.stringify(metadata) : null, new Date().toISOString(),
  );
  return true;
}

export type SponsorRequest = {
  id:string;
  businessId:string;
  dispensaryId:string;
  ownerUserId:string;
  requestType:'featured'|'game';
  billingInterval:'monthly'|'annual'|null;
  gameType:'classic'|'daily'|'hunt'|'mission'|null;
  durationCode:'day'|'week'|'month'|'year'|null;
  geographyType:'all'|'country'|'region'|'city'|'radius';
  geographyValue:string|null;
  radiusKm:number|null;
  preferredStartAt:string|null;
  note:string|null;
  status:'pending'|'approved'|'rejected'|'cancelled';
  reviewedByAdminId:string|null;
  reviewedAt:string|null;
  createdAt:string;
  updatedAt:string;
};

function mapSponsorRequest(row:any):SponsorRequest{
  return {
    id:String(row.id),businessId:String(row.business_id),dispensaryId:String(row.dispensary_id),ownerUserId:String(row.owner_user_id),
    requestType:row.request_type==='game'?'game':'featured',
    billingInterval:row.billing_interval||null,gameType:row.game_type||null,durationCode:row.duration_code||null,
    geographyType:row.geography_type||'all',geographyValue:row.geography_value||null,radiusKm:row.radius_km==null?null:Number(row.radius_km),
    preferredStartAt:row.preferred_start_at||null,note:row.note||null,status:row.status||'pending',
    reviewedByAdminId:row.reviewed_by_admin_id||null,reviewedAt:row.reviewed_at||null,
    createdAt:String(row.created_at),updatedAt:String(row.updated_at),
  };
}

export function listOwnerSponsorshipRequests(userId:string,dispensaryId:string){
  ensureSponsorshipSchema();
  return (getDatabase().prepare(`SELECT * FROM sponsor_requests WHERE owner_user_id=? AND dispensary_id=? ORDER BY created_at DESC`).all(userId,dispensaryId) as any[]).map(mapSponsorRequest);
}

export function listSponsorshipRequests(status?:string){
  ensureSponsorshipSchema();
  const db=getDatabase();
  const rows=status
    ? db.prepare(`SELECT * FROM sponsor_requests WHERE status=? ORDER BY created_at ASC`).all(status)
    : db.prepare(`SELECT * FROM sponsor_requests ORDER BY created_at DESC`).all();
  return (rows as any[]).map(mapSponsorRequest);
}

export function createOwnerSponsorshipRequest(userId:string,dispensaryId:string,input:{
  requestType:'featured'|'game';
  billingInterval?:'monthly'|'annual'|null;
  gameType?:'classic'|'daily'|'hunt'|'mission'|null;
  durationCode?:'day'|'week'|'month'|'year'|null;
  geographyType?:'all'|'country'|'region'|'city'|'radius';
  geographyValue?:string|null;
  radiusKm?:number|null;
  preferredStartAt?:string|null;
  note?:string|null;
}){
  ensureSponsorshipSchema();
  const business=businessForVerifiedOwner(userId,dispensaryId);
  if(!business)throw new Error('Verified dispensary owner access is required.');
  const requestType=input.requestType==='game'?'game':'featured';
  const billingInterval=requestType==='featured'?(input.billingInterval==='annual'?'annual':'monthly'):null;
  const gameType=requestType==='game'&&['classic','daily','hunt','mission'].includes(String(input.gameType))?String(input.gameType):null;
  if(requestType==='game'&&!gameType)throw new Error('Choose Classic GeoWeedo, Daily Weedo, Weedo Hunt, or Sponsored Mission.');
  const durationCode=requestType==='game'&&['day','week','month','year'].includes(String(input.durationCode))?String(input.durationCode):null;
  if(requestType==='game'&&!durationCode)throw new Error('Choose a sponsorship duration.');
  const geographyType=['all','country','region','city','radius'].includes(String(input.geographyType))?String(input.geographyType):'all';
  const geographyValue=geographyType==='all'||geographyType==='radius'?null:String(input.geographyValue||'').trim()||null;
  const radiusKm=geographyType==='radius'?Number(input.radiusKm||0):null;
  if(geographyType==='radius'&&(!Number.isFinite(radiusKm)||Number(radiusKm)<=0))throw new Error('Radius sponsorships require a positive radius.');
  const preferredStartAt=input.preferredStartAt?new Date(input.preferredStartAt):null;
  if(preferredStartAt&&!Number.isFinite(preferredStartAt.getTime()))throw new Error('Preferred start date is invalid.');
  const db=getDatabase();
  const duplicate=db.prepare(`SELECT id FROM sponsor_requests WHERE owner_user_id=? AND dispensary_id=? AND request_type=? AND status='pending' ORDER BY created_at DESC LIMIT 1`).get(userId,dispensaryId,requestType) as {id:string}|undefined;
  if(duplicate)throw new Error('A pending '+(requestType==='game'?'game sponsorship':'Featured')+' request already exists for this dispensary.');
  const now=new Date().toISOString(),id=`sponsor-request-${crypto.randomUUID()}`;
  db.prepare(`INSERT INTO sponsor_requests(id,business_id,dispensary_id,owner_user_id,request_type,billing_interval,game_type,duration_code,geography_type,geography_value,radius_km,preferred_start_at,note,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(
      id,business.id,dispensaryId,userId,requestType,billingInterval,gameType,durationCode,geographyType,geographyValue,radiusKm,
      preferredStartAt?preferredStartAt.toISOString():null,String(input.note||'').trim().slice(0,1000)||null,now,now
    );
  return mapSponsorRequest(db.prepare('SELECT * FROM sponsor_requests WHERE id=?').get(id));
}

export function updateOwnerSponsorshipRequestStatus(userId:string,requestId:string,status:'cancelled'){
  ensureSponsorshipSchema();
  const db=getDatabase(),now=new Date().toISOString();
  const row=db.prepare('SELECT * FROM sponsor_requests WHERE id=? AND owner_user_id=? LIMIT 1').get(requestId,userId) as any;
  if(!row)throw new Error('Sponsorship request not found.');
  if(row.status!=='pending')throw new Error('Only pending requests can be cancelled.');
  db.prepare(`UPDATE sponsor_requests SET status=?,updated_at=? WHERE id=?`).run(status,now,requestId);
  return mapSponsorRequest(db.prepare('SELECT * FROM sponsor_requests WHERE id=?').get(requestId));
}

export function reviewSponsorshipRequest(requestId:string,status:'approved'|'rejected',adminId:string){
  ensureSponsorshipSchema();
  const db=getDatabase(),now=new Date().toISOString();
  const row=db.prepare('SELECT * FROM sponsor_requests WHERE id=? LIMIT 1').get(requestId) as any;
  if(!row)throw new Error('Sponsorship request not found.');
  db.prepare(`UPDATE sponsor_requests SET status=?,reviewed_by_admin_id=?,reviewed_at=?,updated_at=? WHERE id=?`).run(status,adminId,now,now,requestId);
  return mapSponsorRequest(db.prepare('SELECT * FROM sponsor_requests WHERE id=?').get(requestId));
}

export function sponsorshipSummaryForOwner(userId: string, dispensaryId: string) {
  ensureSponsorshipSchema();
  expireEndedFeaturedEntitlements();
  const business = businessForVerifiedOwner(userId, dispensaryId);
  if (!business) return null;
  const db=getDatabase();
  const featured = db.prepare(`SELECT * FROM sponsor_entitlements WHERE business_id=? AND dispensary_id=? AND entitlement_type='featured_listing' ORDER BY created_at DESC LIMIT 1`).get(business.id, dispensaryId) as any;
  const sinceDate=new Date();sinceDate.setUTCHours(0,0,0,0);sinceDate.setUTCDate(sinceDate.getUTCDate()-29);
  const since=sinceDate.toISOString();
  const rows = db.prepare(`SELECT event_type,COUNT(*) count FROM sponsor_events WHERE dispensary_id=? AND created_at>=? GROUP BY event_type`).all(dispensaryId, since) as any[];
  const metrics: Record<string, number> = { pin_impression:0,pin_click:0,listing_view:0,website_click:0,menu_click:0,directions_click:0,game_impression:0,game_completed:0 };
  for (const row of rows) metrics[String(row.event_type)] = Number(row.count || 0);
  const trendRows=db.prepare(`SELECT substr(created_at,1,10) day,event_type,COUNT(*) count FROM sponsor_events WHERE dispensary_id=? AND created_at>=? GROUP BY day,event_type ORDER BY day`).all(dispensaryId,since) as any[];
  const byDay=new Map<string,Record<string,number>>();
  for(let offset=0;offset<30;offset++){
    const day=new Date(sinceDate.getTime()+offset*86400000).toISOString().slice(0,10);
    byDay.set(day,{pin_impression:0,pin_click:0,listing_view:0,website_click:0,menu_click:0,directions_click:0,game_impression:0,game_completed:0});
  }
  for(const row of trendRows){const bucket=byDay.get(String(row.day));if(bucket)bucket[String(row.event_type)]=Number(row.count||0);}
  const dailyTrend=Array.from(byDay.entries()).map(([date,counts])=>({date,...counts,total:Object.values(counts).reduce((sum,value)=>sum+Number(value||0),0)}));
  return {
    business: { id: business.id, name: business.name },
    featured: featured ? { status: featured.status, startsAt: featured.starts_at, endsAt: featured.ends_at, source: featured.source, planCode: featured.plan_code, currency: 'USD' } : null,
    plan: { code:'featured', name:'GeoWeedo Featured', currency:'USD', monthlyPriceCents:3900, annualPriceCents:39000 },
    metrics,
    dailyTrend,
    requests:listOwnerSponsorshipRequests(userId,dispensaryId),
  };
}