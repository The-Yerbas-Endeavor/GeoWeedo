import crypto from 'node:crypto';
import {getDatabase} from '@/lib/sqlite';
import {ensureSponsorshipSchema} from '@/lib/sponsorshipStore';

export type GameCampaignType='classic'|'daily'|'hunt';
export type CampaignGeographyType='all'|'country'|'region'|'city'|'radius';
export type GameCampaignStatus='active'|'paused'|'expired'|'cancelled';
export type GameCampaignSource='admin_comp'|'manual_invoice'|'subscription';

export type GameCampaign={
 id:string;
 businessId:string;
 dispensaryId:string;
 gameType:GameCampaignType;
 placement:string;
 geographyType:CampaignGeographyType;
 geographyValue:string|null;
 radiusKm:number|null;
 startsAt:string;
 endsAt:string;
 status:GameCampaignStatus;
 source:GameCampaignSource;
 amountCents:number|null;
 currency:'USD';
 title:string|null;
 createdAt:string;
 updatedAt:string;
};

type CampaignRow={
 id:string;business_id:string;dispensary_id:string;game_type:GameCampaignType;placement:string;
 geography_type:CampaignGeographyType;geography_value:string|null;radius_km:number|null;
 starts_at:string;ends_at:string;status:GameCampaignStatus;source:GameCampaignSource;
 amount_cents:number|null;currency:'USD';title:string|null;created_at:string;updated_at:string;
};

function id(prefix:string){return `${prefix}-${crypto.randomBytes(10).toString('hex')}`;}
function mapCampaign(row:CampaignRow):GameCampaign{return{
 id:row.id,businessId:row.business_id,dispensaryId:row.dispensary_id,gameType:row.game_type,
 placement:row.placement,geographyType:row.geography_type,geographyValue:row.geography_value,radiusKm:row.radius_km,
 startsAt:row.starts_at,endsAt:row.ends_at,status:row.status,source:row.source,amountCents:row.amount_cents,
 currency:row.currency,title:row.title,createdAt:row.created_at,updatedAt:row.updated_at,
};}

export function ensureGameCampaignSchema(){
 ensureSponsorshipSchema();
 const db=getDatabase();
 db.exec(`
  CREATE TABLE IF NOT EXISTS sponsor_game_campaigns (
   id TEXT PRIMARY KEY,
   business_id TEXT NOT NULL,
   dispensary_id TEXT NOT NULL,
   game_type TEXT NOT NULL,
   placement TEXT NOT NULL DEFAULT 'presented_by',
   geography_type TEXT NOT NULL DEFAULT 'all',
   geography_value TEXT,
   radius_km REAL,
   starts_at TEXT NOT NULL,
   ends_at TEXT NOT NULL,
   status TEXT NOT NULL DEFAULT 'active',
   source TEXT NOT NULL DEFAULT 'admin_comp',
   amount_cents INTEGER,
   currency TEXT NOT NULL DEFAULT 'USD',
   title TEXT,
   metadata_json TEXT,
   granted_by_admin_id TEXT,
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL,
   FOREIGN KEY(business_id) REFERENCES sponsor_businesses(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS sponsor_game_campaign_active_idx ON sponsor_game_campaigns(game_type,status,starts_at,ends_at);
  CREATE INDEX IF NOT EXISTS sponsor_game_campaign_location_idx ON sponsor_game_campaigns(dispensary_id,game_type,status);
 `);
}

function businessForDispensary(dispensaryId:string,now:string){
 ensureGameCampaignSchema();
 const db=getDatabase();
 const existing=db.prepare(`SELECT b.id FROM sponsor_businesses b JOIN sponsor_business_locations bl ON bl.business_id=b.id WHERE bl.dispensary_id=? ORDER BY b.created_at ASC LIMIT 1`).get(dispensaryId) as {id:string}|undefined;
 if(existing?.id)return existing.id;
 const businessId=id('business');
 db.prepare(`INSERT INTO sponsor_businesses (id,owner_user_id,name,status,billing_email,created_at,updated_at) VALUES (?,NULL,?,'active',NULL,?,?)`).run(businessId,`GeoWeedo business ${dispensaryId}`,now,now);
 db.prepare(`INSERT INTO sponsor_business_locations (id,business_id,dispensary_id,role,created_at) VALUES (?,?,?,?,?)`).run(id('business-location'),businessId,dispensaryId,'primary',now);
 return businessId;
}

export function listGameCampaigns(){
 ensureGameCampaignSchema();
 return (getDatabase().prepare(`SELECT * FROM sponsor_game_campaigns ORDER BY starts_at DESC,created_at DESC`).all() as CampaignRow[]).map(mapCampaign);
}

export function grantGameCampaign(input:{
 dispensaryId:string;gameType:GameCampaignType;startsAt:string;endsAt:string;
 placement?:string;geographyType?:CampaignGeographyType;geographyValue?:string|null;radiusKm?:number|null;
 status?:GameCampaignStatus;source?:GameCampaignSource;amountCents?:number|null;title?:string|null;grantedByAdminId?:string|null;
}){
 ensureGameCampaignSchema();
 const starts=new Date(input.startsAt),ends=new Date(input.endsAt);
 if(!Number.isFinite(starts.getTime())||!Number.isFinite(ends.getTime())||ends<=starts)throw new Error('Campaign end must be after its start.');
 if(!['classic','daily','hunt'].includes(input.gameType))throw new Error('Unsupported game campaign type.');
 const geographyType=input.geographyType||'all';
 if(!['all','country','region','city','radius'].includes(geographyType))throw new Error('Unsupported campaign geography.');
 const radiusKm=geographyType==='radius'?Number(input.radiusKm||0):null;
 if(geographyType==='radius'&&(!Number.isFinite(radiusKm)||radiusKm<=0))throw new Error('Radius campaigns require a positive radius.');
 const db=getDatabase(),now=new Date().toISOString(),businessId=businessForDispensary(input.dispensaryId,now),campaignId=id('campaign');
 db.prepare(`INSERT INTO sponsor_game_campaigns (id,business_id,dispensary_id,game_type,placement,geography_type,geography_value,radius_km,starts_at,ends_at,status,source,amount_cents,currency,title,metadata_json,granted_by_admin_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'USD',?,'{}',?,?,?)`).run(
  campaignId,businessId,input.dispensaryId,input.gameType,input.placement||'presented_by',geographyType,input.geographyValue?.trim()||null,radiusKm,
  starts.toISOString(),ends.toISOString(),input.status||'active',input.source||'admin_comp',Number.isFinite(Number(input.amountCents))?Number(input.amountCents):null,input.title?.trim()||null,input.grantedByAdminId||null,now,now
 );
 return mapCampaign(db.prepare(`SELECT * FROM sponsor_game_campaigns WHERE id=?`).get(campaignId) as CampaignRow);
}

export function activeGameCampaign(gameType:GameCampaignType,now=new Date().toISOString()){
 ensureGameCampaignSchema();
 const row=getDatabase().prepare(`SELECT * FROM sponsor_game_campaigns WHERE game_type=? AND status='active' AND starts_at<=? AND ends_at>? ORDER BY starts_at DESC,created_at DESC LIMIT 1`).get(gameType,now,now) as CampaignRow|undefined;
 return row?mapCampaign(row):null;
}

export function getGameCampaign(campaignId:string){
 ensureGameCampaignSchema();
 const row=getDatabase().prepare(`SELECT * FROM sponsor_game_campaigns WHERE id=? LIMIT 1`).get(campaignId) as CampaignRow|undefined;
 return row?mapCampaign(row):null;
}

export function recordGameCampaignEvent(campaignId:string,eventType:'game_impression'|'game_completed',metadata?:Record<string,unknown>){
 const campaign=getGameCampaign(campaignId);
 if(!campaign)return false;
 const now=new Date().toISOString();
 if(campaign.status!=='active'||campaign.startsAt>now||campaign.endsAt<=now)return false;
 getDatabase().prepare(`INSERT INTO sponsor_events (id,business_id,dispensary_id,event_type,metadata_json,created_at) VALUES (?,?,?,?,?,?)`).run(
  id('sponsor-event'),campaign.businessId,campaign.dispensaryId,eventType,JSON.stringify({campaignId:campaign.id,gameType:campaign.gameType,...(metadata||{})}),now
 );
 return true;
}
