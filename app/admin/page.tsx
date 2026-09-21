'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AdminPermission } from '@/lib/adminPermissions';
import styles from './admin.module.css';

type AdminUser = {
  username: string;
  displayName?: string;
  role: string;
  permissions?: AdminPermission[];
};

type VisitorTrendRow = { day:string; visitors:number };
type CurrentVisitor = { visitorId:string; path:string; lastSeenAt:string; location:string };

type OverviewPayload = {
  admin: AdminUser;
  analytics: null | {
    days:number; activeNow:number; visitors:number; sessions:number; pageViews:number;
    visitorTrend:VisitorTrendRow[];
    currentVisitors:CurrentVisitor[];
  };
  scans: null | {
    products:number; qrCodes:number; scanEvents:number; recentQrCodes:number; unlinkedQrCodes:number;
    recent:Array<{id:string;name:string;brand:string;source:string;linked:boolean;scans:number;lastSeenAt:string}>;
  };
  users: null | {
    total:number; newUsers:number; activeUsers:number; suspended:number;
    recent:Array<{id:string;name:string;createdAt:string;lastLoginAt:string|null}>;
  };
  dispensaries: null | {
    total:number; active:number; playable:number; storesWithMenus:number; activeFeatured:number; activeCampaigns:number; sponsorEvents:number; sponsorshipVisible:boolean;
    recent:Array<{id:string;name:string;location:string;active:boolean;playable:boolean;updatedAt:string}>;
  };
};

function dateLabel(value:string){
  if(!value)return '—';
  const time=Date.parse(value);
  if(!Number.isFinite(time))return value;
  const minutes=Math.max(0,Math.round((Date.now()-time)/60000));
  if(minutes<2)return 'just now';
  if(minutes<60)return `${minutes}m ago`;
  const hours=Math.round(minutes/60);
  if(hours<24)return `${hours}h ago`;
  const days=Math.round(hours/24);
  return `${days}d ago`;
}

function Metric({value,label,attention=false}:{value:number;label:string;attention?:boolean}){
  return <div className={`${styles.dashboardMetric} ${attention?styles.dashboardMetricAttention:''}`}><strong>{value.toLocaleString()}</strong><span>{label}</span></div>;
}

function sparklinePoints(values:number[],width=520,height=96){
  if(!values.length)return '';
  const max=Math.max(1,...values);
  return values.map((value,index)=>{
    const x=values.length===1?width/2:(index/(values.length-1))*width;
    const y=height-8-(value/max)*(height-18);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function dayLabel(day:string){
  const date=new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime())?date.toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'}):day;
}

function LiveAnalytics({trend,currentVisitors,activeNow}:{trend:VisitorTrendRow[];currentVisitors:CurrentVisitor[];activeNow:number}){
  const values=trend.map(row=>Number(row.visitors||0));
  const peak=Math.max(0,...values);
  return <div className={styles.dashboardLive}>
    <div className={styles.dashboardLiveHead}>
      <div><strong>Visitor trend</strong><span>Daily unique public visitors · last 7 days</span></div>
      <div><b>{activeNow.toLocaleString()}</b><span>current · daily peak {peak.toLocaleString()}</span></div>
    </div>
    <div className={styles.dashboardLiveChart}>
      <svg viewBox="0 0 520 96" preserveAspectRatio="none" role="img" aria-label="Daily unique visitors during the last seven days">
        <line x1="0" x2="520" y1="88" y2="88"/>
        <line x1="0" x2="520" y1="48" y2="48"/>
        <polyline points={sparklinePoints(values)} fill="none" vectorEffect="non-scaling-stroke"/>
      </svg>
      <div className={styles.dashboardLiveAxis}>{trend.map(row=><span key={row.day}>{dayLabel(row.day)}</span>)}</div>
    </div>
    <div className={styles.dashboardCurrentVisitors}>
      <div className={styles.dashboardRecentHead}><strong>Current visitors & pages</strong><span>{activeNow.toLocaleString()} seen in the last 10 minutes · refreshes every 30s</span></div>
      {currentVisitors.length?currentVisitors.map(row=><div className={styles.dashboardCurrentRow} key={row.visitorId}>
        <div><i aria-hidden="true"/><strong>{row.path}</strong><span>{row.location||'Location unavailable'}</span></div>
        <time>{dateLabel(row.lastSeenAt)}</time>
      </div>):<p className={styles.dashboardEmpty}>No public visitors active right now.</p>}
    </div>
  </div>;
}

export default function AdminHomePage() {
  const [data,setData]=useState<OverviewPayload|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    let cancelled=false;
    let first=true;
    const load=()=>{
      fetch('/api/admin/overview',{cache:'no-store'})
        .then(async response=>{
          if(response.status===401){window.location.href='/admin/login';return null;}
          const body=await response.json().catch(()=>({}));
          if(!response.ok)throw new Error(body.error||'Could not load Admin overview.');
          return body as OverviewPayload;
        })
        .then(value=>{if(!cancelled&&value){setData(value);setError('');}})
        .catch(err=>{if(!cancelled&&first)setError(err instanceof Error?err.message:'Could not load Admin overview.');})
        .finally(()=>{if(!cancelled&&first){first=false;setLoading(false);}});
    };
    load();
    const timer=window.setInterval(load,30000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[]);

  async function logout(){
    await fetch('/api/admin/auth/logout',{method:'POST'});
    window.location.href='/admin/login';
  }

  if(loading)return <main className={styles.shell}><p className={styles.loading}>Loading GeoWeedo overview…</p></main>;
  if(error)return <main className={styles.shell}><div className={styles.dashboardError}>{error}</div></main>;
  if(!data)return null;

  if(data.admin.role==='verified_dispensary'){
    return <main className={styles.shell}>
      <header className={styles.header}><div><span className={styles.eyebrow}>OVERVIEW</span><h1>My GeoWeedo</h1><p>Manage your dispensary profile and menu.</p></div><div className={styles.identity}><span>{data.admin.displayName||data.admin.username}</span><button type="button" onClick={logout}>Log out</button></div></header>
      <section className={styles.dashboardSingle}><Link href="/admin/my-dispensary" className={styles.dashboardCard}><div className={styles.dashboardCardHead}><div><span className={styles.eyebrow}>BUSINESS</span><h2>My dispensary</h2></div><b>Open →</b></div><p>Update your public profile, current products, and business information.</p></Link></section>
    </main>;
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>OVERVIEW</span><h1>GeoWeedo at a glance</h1><p>Traffic, scans, users, dispensaries, and sponsorship activity without opening five separate admin tools.</p></div>
      <div className={styles.identity}><span>{data.admin.displayName||data.admin.username}</span><button type="button" onClick={logout}>Log out</button></div>
    </header>

    <section className={styles.dashboardGrid}>
      {data.analytics?<article className={styles.dashboardCard}>
        <div className={styles.dashboardCardHead}><div><span className={styles.eyebrow}>LAST 7 DAYS</span><h2>Analytics</h2></div><Link href="/admin/analytics">Full analytics →</Link></div>
        <div className={styles.dashboardMetrics}>
          <Metric value={data.analytics.activeNow} label="Active now"/>
          <Metric value={data.analytics.visitors} label="Visitors"/>
          <Metric value={data.analytics.sessions} label="Sessions"/>
          <Metric value={data.analytics.pageViews} label="Page views"/>
        </div>
        <LiveAnalytics trend={data.analytics.visitorTrend} currentVisitors={data.analytics.currentVisitors} activeNow={data.analytics.activeNow}/>
        <p className={styles.dashboardNote}>Public traffic only; Admin page views are excluded.</p>
      </article>:null}

      {data.scans?<article className={styles.dashboardCard}>
        <div className={styles.dashboardCardHead}><div><span className={styles.eyebrow}>GEOWEEDO FACTS</span><h2>Scans & products</h2></div><Link href="/admin/products-menus">Open products →</Link></div>
        <div className={styles.dashboardMetrics}>
          <Metric value={data.scans.recentQrCodes} label="QRs seen · 7d"/>
          <Metric value={data.scans.scanEvents} label="Scan events"/>
          <Metric value={data.scans.products} label="Products"/>
          <Metric value={data.scans.unlinkedQrCodes} label="Need linkage" attention={data.scans.unlinkedQrCodes>0}/>
        </div>
        <div className={styles.dashboardRecent}><div className={styles.dashboardRecentHead}><strong>Recent scans</strong><span>{data.scans.qrCodes.toLocaleString()} stored QR codes</span></div>
          {data.scans.recent.length?data.scans.recent.map(row=><div className={styles.dashboardRecentRow} key={row.id}><div><strong>{row.brand?`${row.brand} · `:''}{row.name}</strong><span>{row.source||'Scanner'} · {row.linked?'linked':'needs linkage'}</span></div><time>{dateLabel(row.lastSeenAt)}</time></div>):<p className={styles.dashboardEmpty}>No scans recorded yet.</p>}
        </div>
      </article>:null}

      {data.users?<article className={styles.dashboardCard}>
        <div className={styles.dashboardCardHead}><div><span className={styles.eyebrow}>COMMUNITY</span><h2>Users</h2></div><Link href="/admin/users">Open users →</Link></div>
        <div className={styles.dashboardMetrics}>
          <Metric value={data.users.total} label="Total users"/>
          <Metric value={data.users.newUsers} label="New · 7d"/>
          <Metric value={data.users.activeUsers} label="Logged in · 7d"/>
          <Metric value={data.users.suspended} label="Suspended" attention={data.users.suspended>0}/>
        </div>
        <div className={styles.dashboardRecent}><div className={styles.dashboardRecentHead}><strong>Recent accounts</strong><span>Newest registrations</span></div>
          {data.users.recent.length?data.users.recent.map(row=><div className={styles.dashboardRecentRow} key={row.id}><div><strong>{row.name}</strong><span>{row.lastLoginAt?'Has signed in':'Not signed in yet'}</span></div><time>{dateLabel(row.createdAt)}</time></div>):<p className={styles.dashboardEmpty}>No user accounts yet.</p>}
        </div>
      </article>:null}

      {data.dispensaries?<article className={styles.dashboardCard}>
        <div className={styles.dashboardCardHead}><div><span className={styles.eyebrow}>NETWORK</span><h2>Dispensaries & sponsorships</h2></div><div className={styles.dashboardCardLinks}><Link href="/admin/dispensaries">Locations →</Link>{data.dispensaries.sponsorshipVisible?<Link href="/admin/sponsorships">Sponsors →</Link>:null}</div></div>
        <div className={styles.dashboardMetrics}>
          <Metric value={data.dispensaries.total} label="Dispensaries"/>
          <Metric value={data.dispensaries.playable} label="Playable"/>
          <Metric value={data.dispensaries.storesWithMenus} label="With menus"/>
          {data.dispensaries.sponsorshipVisible?<Metric value={data.dispensaries.activeFeatured+data.dispensaries.activeCampaigns} label="Active sponsors"/>:<Metric value={data.dispensaries.active} label="Active listings"/>}
        </div>
        {data.dispensaries.sponsorshipVisible?<div className={styles.dashboardSponsorStrip}><div><strong>{data.dispensaries.activeFeatured}</strong><span>Featured listings</span></div><div><strong>{data.dispensaries.activeCampaigns}</strong><span>Game campaigns</span></div><div><strong>{data.dispensaries.sponsorEvents}</strong><span>Sponsor events · 7d</span></div></div>:null}
        <div className={styles.dashboardRecent}><div className={styles.dashboardRecentHead}><strong>Recently updated</strong><span>{data.dispensaries.active.toLocaleString()} active listings</span></div>
          {data.dispensaries.recent.length?data.dispensaries.recent.map(row=><div className={styles.dashboardRecentRow} key={row.id}><div><strong>{row.name}</strong><span>{row.location||'Location unavailable'} · {row.playable?'playable':row.active?'active':'disabled'}</span></div><time>{dateLabel(row.updatedAt)}</time></div>):<p className={styles.dashboardEmpty}>No dispensaries stored yet.</p>}
        </div>
      </article>:null}
    </section>
  </main>;
}
