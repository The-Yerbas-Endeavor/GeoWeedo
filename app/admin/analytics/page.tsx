'use client';

import { useEffect, useState } from 'react';
import styles from '../admin.module.css';

type Summary={days:number;totals:{visitors:number;sessions:number;pageViews:number;activeNow:number;avgDurationMs:number;errors:number};topPages:Array<{path:string;views:number}>;daily:Array<{day:string;page_views:number;visitors:number}>;referrers:Array<{referrer:string;sessions:number}>;locations:Array<{country:string;region:string;city:string;sessions:number}>};
function duration(ms:number){const seconds=Math.round(ms/1000);if(seconds<60)return `${seconds}s`;const minutes=Math.floor(seconds/60),rest=seconds%60;return `${minutes}m ${rest}s`;}

export default function AnalyticsPage(){
 const[data,setData]=useState<Summary|null>(null),[days,setDays]=useState(30),[error,setError]=useState('');
 useEffect(()=>{setError('');fetch(`/api/admin/analytics?days=${days}`,{cache:'no-store'}).then(async r=>{const d=await r.json();if(r.status===401){location.href='/admin/login';return null;}if(!r.ok)throw new Error(d.error||'Analytics failed to load.');return d;}).then(d=>{if(d)setData(d);}).catch(e=>setError(e instanceof Error?e.message:'Analytics failed to load.'));},[days]);
 return <main className={styles.shell}>
  <header className={styles.header}><div><a href="/admin" className={styles.adminHomeLink}><span className={styles.eyebrow}>GEOWEEDO ADMIN</span></a><h1>Analytics</h1><p>First-party traffic, engagement, session duration, referral, location, and reliability analytics stored by GeoWeedo.</p></div><div className={styles.headerActions}><a href="/admin" className={styles.ghost}>Control center</a></div></header>
  <section className={styles.section}>
   <div className={styles.sectionHead}><div><span className={styles.eyebrow}>FIRST-PARTY ANALYTICS</span><h2>Traffic overview</h2></div><select value={days} onChange={e=>setDays(Number(e.target.value))}><option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></div>
   {error&&<p>{error}</p>}
   {!data?<p>Loading analytics…</p>:<>
    <div className={styles.grid}>
     <article className={styles.card}><div className={styles.cardTop}><span className={styles.liveBadge}>LIVE</span><h3>Active now</h3></div><p style={{fontSize:'2rem',margin:0}}>{data.totals.activeNow.toLocaleString()}</p><p>Sessions seen in the last minute.</p></article>
     <article className={styles.card}><div className={styles.cardTop}><h3>Visitors</h3></div><p style={{fontSize:'2rem',margin:0}}>{data.totals.visitors.toLocaleString()}</p><p>Anonymous first-party visitor IDs.</p></article>
     <article className={styles.card}><div className={styles.cardTop}><h3>Sessions</h3></div><p style={{fontSize:'2rem',margin:0}}>{data.totals.sessions.toLocaleString()}</p><p>{data.totals.pageViews.toLocaleString()} page views.</p></article>
     <article className={styles.card}><div className={styles.cardTop}><h3>Average page time</h3></div><p style={{fontSize:'2rem',margin:0}}>{duration(data.totals.avgDurationMs)}</p><p>Measured from page view to leave/navigation.</p></article>
     <article className={styles.card}><div className={styles.cardTop}><h3>Client errors</h3></div><p style={{fontSize:'2rem',margin:0}}>{data.totals.errors.toLocaleString()}</p><p>Unhandled browser errors and rejected promises.</p></article>
    </div>
   </>}
  </section>
  {data&&<section className={styles.section}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>ENGAGEMENT</span><h2>Top pages</h2></div></div><div className={styles.grid}>{data.topPages.map(row=><article className={styles.card} key={row.path}><h3>{row.path||'/'}</h3><p>{Number(row.views).toLocaleString()} views</p></article>)}</div></section>}
  {data&&<section className={styles.section}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>ACQUISITION</span><h2>Referrers</h2></div></div><div className={styles.grid}>{data.referrers.map((row,i)=><article className={styles.card} key={`${row.referrer}-${i}`}><h3>{row.referrer}</h3><p>{Number(row.sessions).toLocaleString()} sessions</p></article>)}</div></section>}
  {data&&<section className={styles.section}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>COARSE LOCATION</span><h2>Visitor geography</h2></div></div><div className={styles.grid}>{data.locations.map((row,i)=><article className={styles.card} key={`${row.country}-${row.region}-${row.city}-${i}`}><h3>{[row.city,row.region,row.country].filter(Boolean).join(', ')}</h3><p>{Number(row.sessions).toLocaleString()} sessions</p></article>)}</div></section>}
  <section className={styles.section}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>PRIVACY</span><h2>Collection policy</h2></div></div><article className={styles.card}><p>Raw analytics events are retained for 90 days by default. GeoWeedo does not store raw IP addresses; a rotating one-way network hash is used instead. Browser Do Not Track and the local <code>geoweedo_analytics_optout</code> flag disable collection.</p></article></section>
 </main>;
}
