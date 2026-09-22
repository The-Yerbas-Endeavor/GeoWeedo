'use client';

import {useEffect,useState} from 'react';
import styles from './AdminDatabaseHealth.module.css';

type Health={
  checkedAt:string;
  database:{path:string;bytes:number;walBytes:number;shmBytes:number;tables:number;indexes:number};
  quickCheck:{status:'ok'|'attention'|'unavailable';message:string};
  lastBackup:null|{name:string;bytes:number;modifiedAt:string};
  largestTables:Array<{name:string;rows:number|null;bytes:number|null}>;
};

function bytes(value:number|null|undefined){
  const size=Number(value||0);
  if(size<1024)return `${size} B`;
  const units=['KB','MB','GB','TB'];
  let n=size/1024,index=0;
  while(n>=1024&&index<units.length-1){n/=1024;index++;}
  return `${n>=100?n.toFixed(0):n>=10?n.toFixed(1):n.toFixed(2)} ${units[index]}`;
}

function age(value:string){
  const time=Date.parse(value);
  if(!Number.isFinite(time))return 'unknown';
  const minutes=Math.max(0,Math.round((Date.now()-time)/60000));
  if(minutes<2)return 'just now';
  if(minutes<60)return `${minutes}m ago`;
  const hours=Math.round(minutes/60);
  if(hours<48)return `${hours}h ago`;
  return `${Math.round(hours/24)}d ago`;
}

export default function AdminDatabaseHealth(){
  const[data,setData]=useState<Health|null>(null);
  const[error,setError]=useState('');
  const[loading,setLoading]=useState(true);

  const load=async(force=false)=>{
    setLoading(true);
    try{
      const response=await fetch(`/api/admin/database-health${force?'?refresh=1':''}`,{cache:'no-store'});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Could not load database health.');
      setData(body as Health);
      setError('');
    }catch(err){
      setError(err instanceof Error?err.message:'Could not load database health.');
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{void load(false);},[]);

  if(!data&&loading)return <section className={styles.card}><p className={styles.loading}>Checking SQLite health…</p></section>;
  if(!data&&error)return <section className={styles.card}><div className={styles.error}>{error}</div></section>;
  if(!data)return null;

  const walRatio=data.database.bytes>0?data.database.walBytes/data.database.bytes:0;
  const walAttention=walRatio>0.5;
  const quickClass=data.quickCheck.status==='ok'?styles.good:data.quickCheck.status==='attention'?styles.bad:styles.warn;

  return <section className={styles.card} aria-labelledby="database-health-title">
    <div className={styles.head}>
      <div>
        <span className={styles.eyebrow}>SQLITE</span>
        <h2 id="database-health-title">Database Health</h2>
        <p>Read-only health snapshot. Expensive checks are cached for 10 minutes.</p>
      </div>
      <button type="button" onClick={()=>void load(true)} disabled={loading}>{loading?'Checking…':'Refresh health'}</button>
    </div>

    <div className={styles.metrics}>
      <div><span>Database</span><strong>{bytes(data.database.bytes)}</strong><small>{data.database.tables.toLocaleString()} tables</small></div>
      <div className={walAttention?styles.attention:''}><span>WAL</span><strong>{bytes(data.database.walBytes)}</strong><small>{walAttention?'Large relative to DB':'Write-ahead log'}</small></div>
      <div><span>Indexes</span><strong>{data.database.indexes.toLocaleString()}</strong><small>User-created indexes</small></div>
      <div className={quickClass}><span>Quick check</span><strong>{data.quickCheck.status==='ok'?'OK':data.quickCheck.status==='attention'?'Attention':'Unavailable'}</strong><small title={data.quickCheck.message}>{data.quickCheck.message}</small></div>
      <div className={!data.lastBackup?styles.warn:''}><span>Last backup</span><strong>{data.lastBackup?age(data.lastBackup.modifiedAt):'None found'}</strong><small>{data.lastBackup?`${data.lastBackup.name} · ${bytes(data.lastBackup.bytes)}`:'No SQLite backup found in data/backups'}</small></div>
    </div>

    <div className={styles.tableHead}>
      <div><strong>Largest tables</strong><span>Actual row counts for the largest SQLite tables by storage</span></div>
      <time title={data.checkedAt}>Checked {age(data.checkedAt)}</time>
    </div>

    <div className={styles.tableWrap}>
      <table>
        <thead><tr><th>Table</th><th>Rows</th><th>Storage</th></tr></thead>
        <tbody>
          {data.largestTables.map(row=><tr key={row.name}>
            <td>{row.name}</td>
            <td>{row.rows==null?'—':row.rows.toLocaleString()}</td>
            <td>{row.bytes==null?'—':bytes(row.bytes)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>

    <div className={styles.footer}>
      <code>{data.database.path}</code>
      {data.database.shmBytes>0?<span>SHM {bytes(data.database.shmBytes)}</span>:null}
    </div>
    {error?<div className={styles.inlineError}>{error}</div>:null}
  </section>;
}
