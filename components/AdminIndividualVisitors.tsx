'use client';

import {useEffect,useMemo,useState} from 'react';
import {usePathname} from 'next/navigation';

type Visitor={visitorId:string;userId:string;sessions:number;pageViews:number;firstSeen:string;lastSeen:string;country:string;region:string;city:string;device:string;browser:string;landingPath:string;referrer:string};
const FILTER_KEY='geoweedo_admin_analytics_excluded_ips';
function when(value:string){return value?new Date(value).toLocaleString():'—';}
function shortId(value:string){return value.length>16?`${value.slice(0,12)}…`:value;}

export default function AdminIndividualVisitors(){
 const pathname=usePathname();
 const [users,setUsers]=useState<Visitor[]>([]),[days,setDays]=useState(30),[query,setQuery]=useState(''),[rows,setRows]=useState(25),[page,setPage]=useState(1),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(pathname!='/admin/analytics')return;let cancelled=false;setLoading(true);setError('');let excluded:string[]=[];try{const saved=JSON.parse(localStorage.getItem(FILTER_KEY)||'[]');if(Array.isArray(saved))excluded=saved.map(String).filter(Boolean);}catch{}const params=new URLSearchParams({mode:'users',days:String(days),excludeAdmin:'1'});if(excluded.length)params.set('excludeIps',excluded.join(','));fetch(`/api/admin/analytics?${params}`,{cache:'no-store'}).then(async r=>{const data=await r.json();if(r.status===401){location.href='/admin/login';return null;}if(!r.ok)throw new Error(data.error||'Individual visitors failed to load.');return data;}).then(data=>{if(!cancelled&&data)setUsers(Array.isArray(data.users)?data.users:[]);}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Individual visitors failed to load.');}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true};},[pathname,days]);
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();if(!q)return users;return users.filter(u=>`${u.visitorId} ${u.userId} ${u.city} ${u.region} ${u.country} ${u.device} ${u.browser} ${u.landingPath} ${u.referrer}`.toLowerCase().includes(q));},[users,query]);
 useEffect(()=>setPage(1),[query,rows,days]);
 const pages=Math.max(1,Math.ceil(filtered.length/rows)),safePage=Math.min(page,pages),start=(safePage-1)*rows,shown=filtered.slice(start,start+rows);
 if(pathname!='/admin/analytics')return null;
 return <section className="admin-individual-visitors">
  <div className="admin-individual-visitors-head"><div><span>INDIVIDUAL USERS</span><h2>Visitor activity</h2><p>Each row represents one persistent browser visitor. Signed-in visits are linked to their GeoWeedo account ID.</p></div><select value={days} onChange={e=>setDays(Number(e.target.value))} aria-label="Visitor analytics range"><option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></div>
  <div className="admin-individual-visitors-tools"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search visitor, account, location, device…"/><label>Rows <select value={rows} onChange={e=>setRows(Number(e.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
  <div className="admin-individual-visitors-status">{loading?'Loading individual users…':error||`${filtered.length.toLocaleString()} individual visitor${filtered.length===1?'':'s'} · Page ${safePage} of ${pages}`}</div>
  {!loading&&!error&&<div className="admin-individual-visitors-table-wrap"><table className="admin-table admin-individual-visitors-table"><thead><tr><th>Visitor</th><th>Account</th><th>Location</th><th>Device</th><th>Sessions</th><th>Views</th><th>First seen</th><th>Last seen</th><th>Landing / referrer</th></tr></thead><tbody>{shown.length?shown.map(user=><tr key={user.visitorId}><td title={user.visitorId}><code>{shortId(user.visitorId)}</code></td><td>{user.userId?<code title={user.userId}>{shortId(user.userId)}</code>:<span className="admin-visitor-anonymous">Anonymous</span>}</td><td>{[user.city,user.region,user.country].filter(Boolean).join(', ')||'Unknown'}</td><td>{user.device} · {user.browser}</td><td>{user.sessions.toLocaleString()}</td><td>{user.pageViews.toLocaleString()}</td><td>{when(user.firstSeen)}</td><td>{when(user.lastSeen)}</td><td><span className="admin-visitor-route">{user.landingPath||'/'}</span>{user.referrer&&<small>{user.referrer}</small>}</td></tr>):<tr><td colSpan={9}>No visitors match the current range and search.</td></tr>}</tbody></table></div>}
  {pages>1&&<div className="admin-individual-visitors-pages"><button disabled={safePage<=1} onClick={()=>setPage(1)}>First</button><button disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button><span>{start+1}–{Math.min(start+rows,filtered.length)} of {filtered.length}</span><button disabled={safePage>=pages} onClick={()=>setPage(p=>Math.min(pages,p+1))}>Next</button><button disabled={safePage>=pages} onClick={()=>setPage(pages)}>Last</button></div>}
 </section>;
}
