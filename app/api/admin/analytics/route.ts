import { NextRequest, NextResponse } from 'next/server';
import { analyticsSummary, analyticsTrend, getAnalyticsDb, analyticsNetworkHashForDay, analyticsStableNetworkHash } from '@/lib/analytics';
import { getAdminFromRequest } from '@/lib/adminAuth';

export const runtime='nodejs';
function clean(value:string|null,max=200){return String(value||'').trim().slice(0,max);}
function requestIp(request:NextRequest){return clean(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||request.headers.get('x-real-ip'),128);}
function recentTrend(hours:number,excludeAdmin:boolean,excludeIps:string[]){
 const database=getAnalyticsDb(),range=Math.max(1,Math.min(24,hours)),bucketMinutes=range<=1?5:range<=6?15:60,now=Date.now(),start=now-range*3600000,bucketMs=bucketMinutes*60000,count=Math.ceil((now-start)/bucketMs),ips=Array.from(new Set(excludeIps.filter(Boolean))),days=Array.from(new Set([new Date(start).toISOString().slice(0,10),new Date(now).toISOString().slice(0,10)])),dailyHashes=days.flatMap(day=>ips.map(ip=>analyticsNetworkHashForDay(ip,day))),stableHashes=ips.map(analyticsStableNetworkHash);
 const clauses=[`e.event_type='page_view'`,`e.created_at>=?`,`e.created_at<=?`],params:any[]=[new Date(start).toISOString(),new Date(now).toISOString()];
 if(excludeAdmin)clauses.push(`COALESCE(e.path,'/') NOT LIKE '/admin%'`);
 if(dailyHashes.length){clauses.push(`(s.network_hash IS NULL OR s.network_hash NOT IN (${dailyHashes.map(()=>'?').join(',')}))`);params.push(...dailyHashes)}
 if(stableHashes.length){clauses.push(`(s.stable_network_hash IS NULL OR s.stable_network_hash NOT IN (${stableHashes.map(()=>'?').join(',')}))`);params.push(...stableHashes)}
 const rows=database.prepare(`SELECT e.created_at,e.visitor_id,e.session_id FROM analytics_events e JOIN analytics_sessions s ON s.id=e.session_id WHERE ${clauses.join(' AND ')} ORDER BY e.created_at`).all(...params) as Array<{created_at:string;visitor_id:string;session_id:string}>;
 const buckets=Array.from({length:count},(_,i)=>({day:new Date(start+i*bucketMs).toISOString(),page_views:0,visitors:0,sessions:0,_visitors:new Set<string>(),_sessions:new Set<string>()}));
 const totalVisitors=new Set<string>(),totalSessions=new Set<string>();
 for(const row of rows){const t=new Date(row.created_at).getTime(),index=Math.min(count-1,Math.max(0,Math.floor((t-start)/bucketMs))),bucket=buckets[index];bucket.page_views++;bucket._visitors.add(row.visitor_id);bucket._sessions.add(row.session_id);totalVisitors.add(row.visitor_id);totalSessions.add(row.session_id)}
 const daily=buckets.map(({_visitors,_sessions,...bucket})=>({...bucket,visitors:_visitors.size,sessions:_sessions.size}));
 return {daily,totals:{pageViews:rows.length,visitors:totalVisitors.size,sessions:totalSessions.size},granularity:bucketMinutes===60?'hour':`${bucketMinutes} minutes`,hours:range};
}
function currentVisitors(excludeAdmin:boolean,excludeIps:string[]){
 const database=getAnalyticsDb(),since=new Date(Date.now()-10*60000).toISOString(),ips=Array.from(new Set(excludeIps.filter(Boolean))),today=new Date().toISOString().slice(0,10),dailyHashes=ips.map(ip=>analyticsNetworkHashForDay(ip,today)),stableHashes=ips.map(analyticsStableNetworkHash),clauses=[`s.last_seen_at>=?`],params:any[]=[since];
 if(excludeAdmin)clauses.push(`EXISTS (SELECT 1 FROM analytics_events ae WHERE ae.session_id=s.id AND ae.event_type='page_view' AND COALESCE(ae.path,'/') NOT LIKE '/admin%')`);
 if(dailyHashes.length){clauses.push(`(s.network_hash IS NULL OR s.network_hash NOT IN (${dailyHashes.map(()=>'?').join(',')}))`);params.push(...dailyHashes)}
 if(stableHashes.length){clauses.push(`(s.stable_network_hash IS NULL OR s.stable_network_hash NOT IN (${stableHashes.map(()=>'?').join(',')}))`);params.push(...stableHashes)}
 return Number((database.prepare(`SELECT COUNT(DISTINCT s.visitor_id) value FROM analytics_sessions s WHERE ${clauses.join(' AND ')}`).get(...params) as any)?.value||0);
}
export async function GET(request:NextRequest){
 if(!getAdminFromRequest(request))return NextResponse.json({error:'Unauthorized.'},{status:401});
 const excludeAdmin=request.nextUrl.searchParams.get('excludeAdmin')==='1';
 const excludeIps=String(request.nextUrl.searchParams.get('excludeIps')||'').split(',').map(v=>v.trim()).filter(Boolean).slice(0,20);
 const hoursRaw=Number(request.nextUrl.searchParams.get('hours')||0);
 if([1,6,24].includes(hoursRaw)){try{return NextResponse.json({trend:recentTrend(hoursRaw,excludeAdmin,excludeIps),currentAdminIp:requestIp(request)},{headers:{'Cache-Control':'no-store'}});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not query recent traffic.'},{status:400});}}
 const start=clean(request.nextUrl.searchParams.get('start'),10),end=clean(request.nextUrl.searchParams.get('end'),10),path=clean(request.nextUrl.searchParams.get('path'),300);
 if(start&&end){try{return NextResponse.json({trend:analyticsTrend({start,end,path,excludeAdmin,excludeIps}),currentAdminIp:requestIp(request)},{headers:{'Cache-Control':'no-store'}});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not query traffic trend.'},{status:400});}}
 const daysRaw=Number(request.nextUrl.searchParams.get('days')||30),days=Number.isFinite(daysRaw)?Math.min(90,Math.max(1,Math.round(daysRaw))):30;
 const summary=analyticsSummary(days,{excludeAdmin,excludeIps});summary.totals.activeNow=currentVisitors(excludeAdmin,excludeIps);
 return NextResponse.json({...summary,currentAdminIp:requestIp(request)},{headers:{'Cache-Control':'no-store'}});
}
