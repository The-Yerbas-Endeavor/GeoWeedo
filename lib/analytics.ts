import { createHash, randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const runtimeDir=path.join(process.cwd(),'data','runtime');
const analyticsPath=path.join(runtimeDir,'analytics.sqlite');
let db:DatabaseSync|null=null;

function init(database:DatabaseSync){
 database.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  CREATE TABLE IF NOT EXISTS analytics_sessions(
   id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, user_id TEXT, network_hash TEXT, country TEXT, region TEXT, city TEXT, user_agent TEXT, language TEXT, timezone TEXT, screen_width INTEGER, screen_height INTEGER, referrer TEXT, landing_path TEXT, started_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, ended_at TEXT
  );
  CREATE TABLE IF NOT EXISTS analytics_events(
   id TEXT PRIMARY KEY, session_id TEXT NOT NULL, visitor_id TEXT NOT NULL, user_id TEXT, event_type TEXT NOT NULL, path TEXT, duration_ms INTEGER, properties_json TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS analytics_sessions_started_idx ON analytics_sessions(started_at);
  CREATE INDEX IF NOT EXISTS analytics_sessions_visitor_idx ON analytics_sessions(visitor_id,started_at);
  CREATE INDEX IF NOT EXISTS analytics_sessions_network_idx ON analytics_sessions(network_hash,started_at);
  CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events(created_at);
  CREATE INDEX IF NOT EXISTS analytics_events_type_idx ON analytics_events(event_type,created_at);
  CREATE INDEX IF NOT EXISTS analytics_events_path_idx ON analytics_events(path,created_at);
  CREATE INDEX IF NOT EXISTS analytics_events_session_idx ON analytics_events(session_id,created_at);
 `);
}
export function getAnalyticsDb(){if(db)return db;mkdirSync(runtimeDir,{recursive:true});db=new DatabaseSync(analyticsPath);init(db);return db;}
function analyticsSalt(){return process.env.ANALYTICS_HASH_SALT||process.env.ADMIN_SESSION_SECRET||'geoweedo-analytics';}
export function analyticsNetworkHashForDay(ip:string,day:string){return createHash('sha256').update(`${day}|${analyticsSalt()}|${ip}`).digest('hex');}
export function analyticsNetworkHash(ip:string){return analyticsNetworkHashForDay(ip,new Date().toISOString().slice(0,10));}
export function pruneAnalytics(days=90){const database=getAnalyticsDb();const cutoff=new Date(Date.now()-Math.max(1,days)*86400000).toISOString();database.prepare('DELETE FROM analytics_events WHERE created_at < ?').run(cutoff);database.prepare('DELETE FROM analytics_sessions WHERE started_at < ?').run(cutoff);}
export function recordAnalyticsEvent(input:{sessionId:string;visitorId:string;userId?:string|null;eventType:string;path?:string|null;durationMs?:number|null;properties?:Record<string,unknown>|null;networkHash?:string|null;country?:string|null;region?:string|null;city?:string|null;userAgent?:string|null;language?:string|null;timezone?:string|null;screenWidth?:number|null;screenHeight?:number|null;referrer?:string|null;}){const database=getAnalyticsDb(),now=new Date().toISOString();const existing=database.prepare('SELECT id FROM analytics_sessions WHERE id=?').get(input.sessionId) as {id?:string}|undefined;if(!existing?.id){database.prepare(`INSERT INTO analytics_sessions(id,visitor_id,user_id,network_hash,country,region,city,user_agent,language,timezone,screen_width,screen_height,referrer,landing_path,started_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.sessionId,input.visitorId,input.userId||null,input.networkHash||null,input.country||null,input.region||null,input.city||null,input.userAgent||null,input.language||null,input.timezone||null,input.screenWidth||null,input.screenHeight||null,input.referrer||null,input.path||null,now,now);}else database.prepare('UPDATE analytics_sessions SET last_seen_at=?, user_id=COALESCE(?,user_id) WHERE id=?').run(now,input.userId||null,input.sessionId);database.prepare(`INSERT INTO analytics_events(id,session_id,visitor_id,user_id,event_type,path,duration_ms,properties_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(),input.sessionId,input.visitorId,input.userId||null,input.eventType,input.path||null,input.durationMs||null,input.properties?JSON.stringify(input.properties):null,now);if(input.eventType==='session_end')database.prepare('UPDATE analytics_sessions SET ended_at=?,last_seen_at=? WHERE id=?').run(now,now,input.sessionId);}

type AnalyticsFilters={excludeIps?:string[];excludeAdmin?:boolean};
function hashListForRange(ips:string[],days:number){const values:string[]=[],unique=Array.from(new Set(ips.map(ip=>ip.trim()).filter(Boolean)));for(let offset=0;offset<=days;offset++){const day=new Date(Date.now()-offset*86400000).toISOString().slice(0,10);for(const ip of unique)values.push(analyticsNetworkHashForDay(ip,day));}return Array.from(new Set(values));}
function classifyDevice(width:number){if(width>0&&width<=760)return 'Mobile';if(width>760&&width<=1100)return 'Tablet';return 'Desktop';}
function classifyBrowser(ua:string){if(/Edg\//i.test(ua))return 'Edge';if(/OPR\//i.test(ua))return 'Opera';if(/Firefox\//i.test(ua))return 'Firefox';if(/Chrome\//i.test(ua))return 'Chrome';if(/Safari\//i.test(ua)&&!/Chrome\//i.test(ua))return 'Safari';return 'Other';}

export function analyticsSummary(days=30,filters:AnalyticsFilters={}){
 const database=getAnalyticsDb(),range=Math.max(1,Math.min(90,days)),since=new Date(Date.now()-range*86400000).toISOString(),oneMinuteAgo=new Date(Date.now()-60000).toISOString(),hashes=hashListForRange(filters.excludeIps||[],range);
 const hashClause=hashes.length?` AND (s.network_hash IS NULL OR s.network_hash NOT IN (${hashes.map(()=>'?').join(',')}))`:'';
 const adminSessionClause=filters.excludeAdmin?` AND EXISTS (SELECT 1 FROM analytics_events ae WHERE ae.session_id=s.id AND ae.event_type='page_view' AND COALESCE(ae.path,'/') NOT LIKE '/admin%')`:'';
 const sessionPredicate=`s.started_at>=?${hashClause}${adminSessionClause}`,sessionParams=[since,...hashes];
 const eventAdminClause=filters.excludeAdmin?` AND COALESCE(e.path,'/') NOT LIKE '/admin%'`:'';
 const eventPredicate=`e.created_at>=?${eventAdminClause} AND EXISTS (SELECT 1 FROM analytics_sessions s WHERE s.id=e.session_id${hashClause})`,eventParams=[since,...hashes];
 const scalar=(sql:string,...params:any[])=>Number((database.prepare(sql).get(...params) as Record<string,unknown>|undefined)?.value||0);
 const totals={visitors:scalar(`SELECT COUNT(DISTINCT s.visitor_id) value FROM analytics_sessions s WHERE ${sessionPredicate}`,...sessionParams),sessions:scalar(`SELECT COUNT(*) value FROM analytics_sessions s WHERE ${sessionPredicate}`,...sessionParams),pageViews:scalar(`SELECT COUNT(*) value FROM analytics_events e WHERE e.event_type='page_view' AND ${eventPredicate}`,...eventParams),activeNow:scalar(`SELECT COUNT(*) value FROM analytics_sessions s WHERE s.last_seen_at>=?${hashClause}${adminSessionClause}`,oneMinuteAgo,...hashes),avgDurationMs:scalar(`SELECT COALESCE(AVG(e.duration_ms),0) value FROM analytics_events e WHERE e.event_type='page_leave' AND e.duration_ms IS NOT NULL AND ${eventPredicate}`,...eventParams),errors:scalar(`SELECT COUNT(*) value FROM analytics_events e WHERE e.event_type IN ('client_error','unhandled_rejection') AND ${eventPredicate}`,...eventParams)};
 const topPages=database.prepare(`SELECT e.path path,COUNT(*) views FROM analytics_events e WHERE e.event_type='page_view' AND ${eventPredicate} GROUP BY e.path ORDER BY views DESC LIMIT 12`).all(...eventParams) as any[];
 const pageDaily=database.prepare(`SELECT substr(e.created_at,1,10) day,COUNT(*) page_views,COUNT(DISTINCT e.visitor_id) visitors FROM analytics_events e WHERE e.event_type='page_view' AND ${eventPredicate} GROUP BY day ORDER BY day`).all(...eventParams) as any[];
 const sessionDaily=database.prepare(`SELECT substr(s.started_at,1,10) day,COUNT(*) sessions FROM analytics_sessions s WHERE ${sessionPredicate} GROUP BY day ORDER BY day`).all(...sessionParams) as any[];
 const byDay=new Map<string,{day:string;page_views:number;visitors:number;sessions:number}>();for(let offset=range-1;offset>=0;offset--){const day=new Date(Date.now()-offset*86400000).toISOString().slice(0,10);byDay.set(day,{day,page_views:0,visitors:0,sessions:0});}for(const row of pageDaily){const t=byDay.get(String(row.day));if(t){t.page_views=Number(row.page_views||0);t.visitors=Number(row.visitors||0);}}for(const row of sessionDaily){const t=byDay.get(String(row.day));if(t)t.sessions=Number(row.sessions||0);}const daily=Array.from(byDay.values());
 const referrers=database.prepare(`SELECT COALESCE(NULLIF(s.referrer,''),'Direct') referrer,COUNT(*) sessions FROM analytics_sessions s WHERE ${sessionPredicate} GROUP BY referrer ORDER BY sessions DESC LIMIT 10`).all(...sessionParams) as any[];
 const locations=database.prepare(`SELECT COALESCE(s.country,'Unknown') country,COALESCE(s.region,'') region,COALESCE(s.city,'') city,COUNT(*) sessions FROM analytics_sessions s WHERE ${sessionPredicate} GROUP BY country,region,city ORDER BY sessions DESC LIMIT 20`).all(...sessionParams) as any[];
 const sessionProfiles=database.prepare(`SELECT s.screen_width,s.user_agent,s.language,s.timezone FROM analytics_sessions s WHERE ${sessionPredicate}`).all(...sessionParams) as any[];
 const devices=new Map<string,number>(),browsers=new Map<string,number>(),languages=new Map<string,number>(),timezones=new Map<string,number>();for(const row of sessionProfiles){const device=classifyDevice(Number(row.screen_width||0));devices.set(device,(devices.get(device)||0)+1);const browser=classifyBrowser(String(row.user_agent||''));browsers.set(browser,(browsers.get(browser)||0)+1);const language=String(row.language||'Unknown');languages.set(language,(languages.get(language)||0)+1);const timezone=String(row.timezone||'Unknown');timezones.set(timezone,(timezones.get(timezone)||0)+1);}const ranked=(map:Map<string,number>,key:string)=>Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,sessions])=>({[key]:name,sessions}));const eventTypes=database.prepare(`SELECT e.event_type event_type,COUNT(*) events FROM analytics_events e WHERE ${eventPredicate} AND e.event_type NOT IN ('page_view','page_leave') GROUP BY e.event_type ORDER BY events DESC LIMIT 12`).all(...eventParams);
 return {days:range,filters:{excludeAdmin:Boolean(filters.excludeAdmin),excludedIpCount:(filters.excludeIps||[]).filter(Boolean).length},totals,topPages,daily,referrers,locations,devices:ranked(devices,'device'),browsers:ranked(browsers,'browser'),languages:ranked(languages,'language'),timezones:ranked(timezones,'timezone'),eventTypes};
}

export function analyticsTrend(input:{start:string;end:string;path?:string;excludeIps?:string[];excludeAdmin?:boolean}){
 const database=getAnalyticsDb();let startDay=input.start,endDay=input.end;if(!/^\d{4}-\d{2}-\d{2}$/.test(startDay)||!/^\d{4}-\d{2}-\d{2}$/.test(endDay))throw new Error('Invalid analytics date range.');if(startDay>endDay)[startDay,endDay]=[endDay,startDay];const retentionStart=new Date(Date.now()-89*86400000).toISOString().slice(0,10);if(startDay<retentionStart)startDay=retentionStart;const today=new Date().toISOString().slice(0,10);if(endDay>today)endDay=today;
 const dayCount=Math.max(1,Math.round((new Date(`${endDay}T00:00:00Z`).getTime()-new Date(`${startDay}T00:00:00Z`).getTime())/86400000)+1);const ips=Array.from(new Set((input.excludeIps||[]).map(v=>v.trim()).filter(Boolean)));const hashes:string[]=[];for(let i=0;i<dayCount;i++){const day=new Date(new Date(`${startDay}T00:00:00Z`).getTime()+i*86400000).toISOString().slice(0,10);for(const ip of ips)hashes.push(analyticsNetworkHashForDay(ip,day));}
 const hashClause=hashes.length?` AND (s.network_hash IS NULL OR s.network_hash NOT IN (${hashes.map(()=>'?').join(',')}))`:'';const adminClause=input.excludeAdmin?` AND COALESCE(e.path,'/') NOT LIKE '/admin%'`:'';const path=String(input.path||'').trim();const pathClause=path?` AND COALESCE(e.path,'/') LIKE ? ESCAPE '\\'`:'';const escaped=path.replace(/[\\%_]/g,m=>`\\${m}`);const params:any[]=[`${startDay}T00:00:00.000Z`,`${endDay}T23:59:59.999Z`,...hashes];if(path)params.push(`%${escaped}%`);
 const rows=database.prepare(`SELECT substr(e.created_at,1,10) day,COUNT(*) page_views,COUNT(DISTINCT e.visitor_id) visitors,COUNT(DISTINCT e.session_id) sessions FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id WHERE e.event_type='page_view' AND e.created_at>=? AND e.created_at<=?${hashClause}${adminClause}${pathClause} GROUP BY day ORDER BY day`).all(...params) as any[];
 const byDay=new Map<string,{day:string;page_views:number;visitors:number;sessions:number}>();for(let i=0;i<dayCount;i++){const day=new Date(new Date(`${startDay}T00:00:00Z`).getTime()+i*86400000).toISOString().slice(0,10);byDay.set(day,{day,page_views:0,visitors:0,sessions:0});}for(const row of rows){const t=byDay.get(String(row.day));if(t){t.page_views=Number(row.page_views||0);t.visitors=Number(row.visitors||0);t.sessions=Number(row.sessions||0);}}
 return {start:startDay,end:endDay,path,daily:Array.from(byDay.values()),totals:{pageViews:Array.from(byDay.values()).reduce((n,r)=>n+r.page_views,0),visitors:Array.from(byDay.values()).reduce((n,r)=>n+r.visitors,0),sessions:Array.from(byDay.values()).reduce((n,r)=>n+r.sessions,0)}};
}
