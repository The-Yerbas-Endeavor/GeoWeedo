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
   id TEXT PRIMARY KEY,
   visitor_id TEXT NOT NULL,
   user_id TEXT,
   network_hash TEXT,
   country TEXT,
   region TEXT,
   city TEXT,
   user_agent TEXT,
   language TEXT,
   timezone TEXT,
   screen_width INTEGER,
   screen_height INTEGER,
   referrer TEXT,
   landing_path TEXT,
   started_at TEXT NOT NULL,
   last_seen_at TEXT NOT NULL,
   ended_at TEXT
  );
  CREATE TABLE IF NOT EXISTS analytics_events(
   id TEXT PRIMARY KEY,
   session_id TEXT NOT NULL,
   visitor_id TEXT NOT NULL,
   user_id TEXT,
   event_type TEXT NOT NULL,
   path TEXT,
   duration_ms INTEGER,
   properties_json TEXT,
   created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS analytics_sessions_started_idx ON analytics_sessions(started_at);
  CREATE INDEX IF NOT EXISTS analytics_sessions_visitor_idx ON analytics_sessions(visitor_id,started_at);
  CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events(created_at);
  CREATE INDEX IF NOT EXISTS analytics_events_type_idx ON analytics_events(event_type,created_at);
  CREATE INDEX IF NOT EXISTS analytics_events_path_idx ON analytics_events(path,created_at);
 `);
}

export function getAnalyticsDb(){
 if(db)return db;
 mkdirSync(runtimeDir,{recursive:true});
 db=new DatabaseSync(analyticsPath);
 init(db);
 return db;
}

export function analyticsNetworkHash(ip:string){
 const day=new Date().toISOString().slice(0,10);
 const salt=process.env.ANALYTICS_HASH_SALT||process.env.ADMIN_SESSION_SECRET||'geoweedo-analytics';
 return createHash('sha256').update(`${day}|${salt}|${ip}`).digest('hex');
}

export function pruneAnalytics(days=90){
 const database=getAnalyticsDb();
 const cutoff=new Date(Date.now()-Math.max(1,days)*86400000).toISOString();
 database.prepare('DELETE FROM analytics_events WHERE created_at < ?').run(cutoff);
 database.prepare('DELETE FROM analytics_sessions WHERE started_at < ?').run(cutoff);
}

export function recordAnalyticsEvent(input:{
 sessionId:string;visitorId:string;userId?:string|null;eventType:string;path?:string|null;durationMs?:number|null;
 properties?:Record<string,unknown>|null;networkHash?:string|null;country?:string|null;region?:string|null;city?:string|null;
 userAgent?:string|null;language?:string|null;timezone?:string|null;screenWidth?:number|null;screenHeight?:number|null;referrer?:string|null;
}){
 const database=getAnalyticsDb();
 const now=new Date().toISOString();
 const existing=database.prepare('SELECT id FROM analytics_sessions WHERE id=?').get(input.sessionId) as {id?:string}|undefined;
 if(!existing?.id){
  database.prepare(`INSERT INTO analytics_sessions(id,visitor_id,user_id,network_hash,country,region,city,user_agent,language,timezone,screen_width,screen_height,referrer,landing_path,started_at,last_seen_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.sessionId,input.visitorId,input.userId||null,input.networkHash||null,input.country||null,input.region||null,input.city||null,input.userAgent||null,input.language||null,input.timezone||null,input.screenWidth||null,input.screenHeight||null,input.referrer||null,input.path||null,now,now);
 }else{
  database.prepare('UPDATE analytics_sessions SET last_seen_at=?, user_id=COALESCE(?,user_id) WHERE id=?').run(now,input.userId||null,input.sessionId);
 }
 database.prepare(`INSERT INTO analytics_events(id,session_id,visitor_id,user_id,event_type,path,duration_ms,properties_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
  .run(randomUUID(),input.sessionId,input.visitorId,input.userId||null,input.eventType,input.path||null,input.durationMs||null,input.properties?JSON.stringify(input.properties):null,now);
 if(input.eventType==='page_leave'||input.eventType==='session_end')database.prepare('UPDATE analytics_sessions SET ended_at=?,last_seen_at=? WHERE id=?').run(now,now,input.sessionId);
}

export function analyticsSummary(days=30){
 const database=getAnalyticsDb();
 const since=new Date(Date.now()-Math.max(1,days)*86400000).toISOString();
 const oneMinuteAgo=new Date(Date.now()-60000).toISOString();
 const scalar=(sql:string,...params:unknown[])=>Number((database.prepare(sql).get(...params) as Record<string,unknown>|undefined)?.value||0);
 const totals={
  visitors:scalar('SELECT COUNT(DISTINCT visitor_id) value FROM analytics_sessions WHERE started_at>=?',since),
  sessions:scalar('SELECT COUNT(*) value FROM analytics_sessions WHERE started_at>=?',since),
  pageViews:scalar("SELECT COUNT(*) value FROM analytics_events WHERE event_type='page_view' AND created_at>=?",since),
  activeNow:scalar('SELECT COUNT(*) value FROM analytics_sessions WHERE last_seen_at>=?',oneMinuteAgo),
  avgDurationMs:scalar("SELECT COALESCE(AVG(duration_ms),0) value FROM analytics_events WHERE event_type='page_leave' AND duration_ms IS NOT NULL AND created_at>=?",since),
  errors:scalar("SELECT COUNT(*) value FROM analytics_events WHERE event_type IN ('client_error','unhandled_rejection') AND created_at>=?",since),
 };
 const topPages=database.prepare("SELECT path,COUNT(*) views FROM analytics_events WHERE event_type='page_view' AND created_at>=? GROUP BY path ORDER BY views DESC LIMIT 12").all(since);
 const daily=database.prepare("SELECT substr(created_at,1,10) day,COUNT(*) page_views,COUNT(DISTINCT visitor_id) visitors FROM analytics_events WHERE event_type='page_view' AND created_at>=? GROUP BY day ORDER BY day").all(since);
 const referrers=database.prepare("SELECT COALESCE(NULLIF(referrer,''),'Direct') referrer,COUNT(*) sessions FROM analytics_sessions WHERE started_at>=? GROUP BY referrer ORDER BY sessions DESC LIMIT 10").all(since);
 const locations=database.prepare("SELECT COALESCE(country,'Unknown') country,COALESCE(region,'') region,COALESCE(city,'') city,COUNT(*) sessions FROM analytics_sessions WHERE started_at>=? GROUP BY country,region,city ORDER BY sessions DESC LIMIT 20").all(since);
 return {days,totals,topPages,daily,referrers,locations};
}
