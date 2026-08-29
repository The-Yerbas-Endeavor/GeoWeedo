'use client';

import { useEffect, useState } from 'react';
import styles from './admin.module.css';

type AdminUser = { id:string; username:string; displayName?:string; role:string };
type ModuleCard = { title:string; description:string; href?:string; status:'live'|'partial'|'planned'; action?:string; secondaryHref?:string; secondaryAction?:string };

const liveModules:ModuleCard[]=[
  {title:'Data import',description:'Import official dispensary data, enrich coordinates, review candidates, and move qualified locations toward gameplay.',href:'/admin/data',status:'live',action:'Open data import'},
  {title:'Dispensary information',description:'Review enabled dispensaries, edit business details, validate imagery, and activate or deactivate gameplay locations.',href:'/admin/dispensaries',status:'live',action:'Manage dispensaries'},
  {title:'User information',description:'Open a consolidated player record with account status, verified YERB address, balance, deposits, withdrawals, rewards, and recorded game history.',href:'/admin/users',status:'live',action:'Manage users'},
  {title:'Yerbas wallet dashboard',description:'Unified view of player wallets, active deposit addresses, ledger balance, deposits, withdrawals, rewards, and pending finance activity.',href:'/admin/wallet',status:'live',action:'Open wallet dashboard'},
  {title:'Rewards',description:'Review the YERB reward ledger and player reward activity before automatic gameplay rewards are enabled.',href:'/admin/rewards',status:'live',action:'Open rewards'},
  {title:'Withdrawals',description:'Review player withdrawal requests and the custody workflow for YERB leaving GeoWeedo.',href:'/admin/withdrawals',status:'live',action:'Open withdrawals'},
  {title:'Sponsorships',description:'Manage dispensary sponsorship records and featured-location activity.',href:'/admin/sponsorships',status:'live',action:'Open sponsorships'},
];

const plannedModules:ModuleCard[]=[
  {title:'Wallet RPC & worker health',description:'Live Yerbas Core RPC connectivity, hot-wallet on-chain balance, sync height, network fees, deposit scanner status, and withdrawal worker health.',status:'planned'},
  {title:'Game analytics',description:'Games played, completion rate, round inventory, scoring distribution, daily challenge activity, and reward exposure.',status:'planned'},
  {title:'Imagery coverage',description:'State-by-state KartaView and GeoWeedo 360 coverage, failed validation reasons, stale imagery, and locations needing review.',status:'planned'},
  {title:'System health',description:'Application instances, database health, background workers, backups, deployment status, and recent errors.',status:'planned'},
  {title:'Admin users & permissions',description:'Create additional administrators, assign roles, manage sessions, and limit access to finance or data-management functions.',status:'planned'},
];

export default function AdminHomePage(){
  const[admin,setAdmin]=useState<AdminUser|null>(null),[loading,setLoading]=useState(true);
  useEffect(()=>{fetch('/api/admin/auth/me',{cache:'no-store'}).then(async r=>{if(r.status===401){window.location.href='/admin/login';return null;}const d=await r.json();if(!r.ok)throw new Error(d.error||'Admin session check failed.');return d.admin||d;}).then(value=>{if(value)setAdmin(value);}).catch(()=>{window.location.href='/admin/login';}).finally(()=>setLoading(false));},[]);
  async function logout(){await fetch('/api/admin/auth/logout',{method:'POST'});window.location.href='/admin/login';}
  if(loading)return <main className={styles.shell}><div className={styles.loading}>Loading GeoWeedo Admin…</div></main>;
  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><a href="/admin" className={styles.adminHomeLink} aria-label="GeoWeedo Admin home"><span className={styles.eyebrow}>GEOWEEDO ADMIN</span></a><h1>Control center</h1><p>Manage the live GeoWeedo platform and keep future administration tools organized in one place.</p></div>
      <div className={styles.headerActions}><div className={styles.adminIdentity}><strong>{admin?.displayName||admin?.username||'Administrator'}</strong><span>{admin?.role||'admin'}</span></div><a href="/" className={styles.ghost}>View game</a><button type="button" className={styles.ghost} onClick={logout}>Log out</button></div>
    </header>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><span className={styles.eyebrow}>AVAILABLE NOW</span><h2>Current operations</h2></div><span className={styles.count}>{liveModules.length} modules</span></div>
      <div className={styles.grid}>{liveModules.map(card=><article className={styles.card} key={card.title}><div className={styles.cardTop}><span className={card.status==='live'?styles.liveBadge:styles.partialBadge}>{card.status==='live'?'LIVE':'PARTIAL'}</span><h3>{card.title}</h3></div><p>{card.description}</p><div className={styles.cardActions}>{card.href&&<a className={styles.primaryLink} href={card.href}>{card.action||'Open'}</a>}{card.secondaryHref&&<a className={styles.secondaryLink} href={card.secondaryHref}>{card.secondaryAction||'Open'}</a>}</div></article>)}</div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><span className={styles.eyebrow}>ROADMAP</span><h2>Future administration</h2></div><span className={styles.count}>{plannedModules.length} planned</span></div>
      <div className={styles.grid}>{plannedModules.map(card=><article className={`${styles.card} ${styles.plannedCard}`} key={card.title}><div className={styles.cardTop}><span className={styles.plannedBadge}>PLANNED</span><h3>{card.title}</h3></div><p>{card.description}</p><div className={styles.futureNote}>Reserved for the next admin layer</div></article>)}</div>
    </section>
  </main>;
}
