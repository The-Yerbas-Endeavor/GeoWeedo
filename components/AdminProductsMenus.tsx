'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import styles from './AdminProductsMenus.module.css';

type Tab='overview'|'products'|'scans'|'exceptions';
type Product={id:string;brand_name:string|null;product_name:string;product_type:string|null;category_name:string|null;net_contents:string|null;barcode:string|null;batch_count:number;menu_count:number};
type VerifiedProduct={id:string;verified_batch_count:number};
type QrScan={id:string;qr_value:string;qr_host:string|null;resolver:string;product_id:string|null;batch_id:string|null;title:string|null;brand_name:string|null;product_name:string|null;canonical_brand_name:string|null;canonical_product_name:string|null;canonical_category_name:string|null;canonical_product_type:string|null;canonical_net_contents:string|null;batch_number:string|null;uid:string|null;coa_number:string|null;overall_status:string|null;canonical_lab_name:string|null;lab_name:string|null;last_seen_at:string;scan_count:number;verified_lab_batch:number};
type Stats={products:number;categorizedProducts:number;uncategorizedProducts:number;verifiedProducts:number;verifiedBatches:number;qrCodes:number;qrScanEvents:number;unlinkedQrs:number;menuItems:number;storesWithMenus:number};
type Payload={stats:Stats;products:Product[];verifiedProducts:VerifiedProduct[];qrScans:QrScan[];uncategorizedProducts:Product[];unlinkedQrScans:QrScan[]};

const emptyStats:Stats={products:0,categorizedProducts:0,uncategorizedProducts:0,verifiedProducts:0,verifiedBatches:0,qrCodes:0,qrScanEvents:0,unlinkedQrs:0,menuItems:0,storesWithMenus:0};
const emptyData:Payload={stats:emptyStats,products:[],verifiedProducts:[],qrScans:[],uncategorizedProducts:[],unlinkedQrScans:[]};
function dateTime(value:string|null|undefined){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString();}
function compact(value:string|null|undefined,max=64){const text=String(value||'').trim();return text.length>max?`${text.slice(0,max-1)}…`:text||'—';}
function isHttp(value:string){return /^https?:\/\//i.test(value);}

export default function AdminProductsMenus(){
 const[data,setData]=useState<Payload>(emptyData);
 const[tab,setTab]=useState<Tab>('overview');
 const[query,setQuery]=useState('');
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState('');
 const[loaded,setLoaded]=useState<Record<Tab,boolean>>({overview:false,products:false,scans:false,exceptions:false});

 async function load(view:Tab,q=''){
  const params=new URLSearchParams({view});
  if(q.trim())params.set('q',q.trim());
  const response=await fetch(`/api/admin/products-menus?${params}`,{cache:'no-store'});
  if(response.status===401){window.location.href='/admin/login';return;}
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Could not load GeoWeedo Facts data.');
  setData(current=>({
   ...current,
   stats:{...current.stats,...(body.stats||{})},
   products:Array.isArray(body.products)?body.products:current.products,
   verifiedProducts:Array.isArray(body.verifiedProducts)?body.verifiedProducts:current.verifiedProducts,
   qrScans:Array.isArray(body.qrScans)?body.qrScans:current.qrScans,
   uncategorizedProducts:Array.isArray(body.uncategorizedProducts)?body.uncategorizedProducts:current.uncategorizedProducts,
   unlinkedQrScans:Array.isArray(body.unlinkedQrScans)?body.unlinkedQrScans:current.unlinkedQrScans,
  }));
  setLoaded(current=>({...current,[view]:true}));
 }

 useEffect(()=>{load('overview').catch(err=>setError(err instanceof Error?err.message:'Load failed.')).finally(()=>setLoading(false));},[]);

 async function openTab(next:Tab){
  setTab(next);setError('');
  if(loaded[next])return;
  setLoading(true);
  try{await load(next,next==='overview'?'':query);}catch(err){setError(err instanceof Error?err.message:'Load failed.');}finally{setLoading(false);}
 }

 async function search(event:FormEvent){
  event.preventDefault();
  const target:Tab=tab==='overview'?'products':tab;
  if(tab==='overview')setTab(target);
  setLoading(true);setError('');
  try{await load(target,query);}catch(err){setError(err instanceof Error?err.message:'Search failed.');}finally{setLoading(false);}
 }
 function clearSearch(){const target=tab==='overview'?'products':tab;setQuery('');setLoading(true);load(target,'').catch(err=>setError(err instanceof Error?err.message:'Load failed.')).finally(()=>setLoading(false));}

 const verifiedById=useMemo(()=>new Map(data.verifiedProducts.map(row=>[row.id,row])),[data.verifiedProducts]);
 const attention=data.stats.unlinkedQrs+data.stats.uncategorizedProducts;

 if(loading&&!loaded.overview)return <main className={styles.shell}><div className={styles.loading}>Loading product summary…</div></main>;

 return <main className={styles.shell}>
  <header className={styles.header}>
   <div><span>GEOWEEDO ADMIN · PRODUCTS</span><h1>Products & scans</h1><p>See what imported successfully, find a product or QR scan, and fix only the records that actually need attention.</p></div>
  </header>

  <section className={styles.summary}>
   <article><strong>{data.stats.products.toLocaleString()}</strong><span>Products</span></article>
   <article><strong>{data.stats.verifiedProducts.toLocaleString()}</strong><span>Lab verified</span></article>
   <article><strong>{data.stats.verifiedBatches.toLocaleString()}</strong><span>Verified batches</span></article>
   <article><strong>{data.stats.qrCodes.toLocaleString()}</strong><span>QR codes</span></article>
   <article className={attention?styles.attentionCard:undefined}><strong>{attention.toLocaleString()}</strong><span>Need attention</span></article>
  </section>

  {error?<div className={styles.error}>{error}</div>:null}

  <section className={styles.workspace}>
   <div className={styles.toolbar}>
    <nav className={styles.tabs} aria-label="Product database sections">
     {([['overview','Overview'],['products','Products'],['scans','QR scans'],['exceptions','Exceptions']] as [Tab,string][]).map(([id,label])=><button key={id} type="button" className={tab===id?styles.activeTab:''} onClick={()=>void openTab(id)}>{label}</button>)}
    </nav>
    <form className={styles.search} onSubmit={search}>
     <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search brand, product, category, UID, COA or QR…" aria-label="Search product database"/>
     <button type="submit" disabled={loading}>{loading?'Searching…':'Search'}</button>
     {query?<button type="button" className={styles.clearButton} onClick={clearSearch}>Clear</button>:null}
    </form>
   </div>

   {loading&&!loaded[tab]?<div className={styles.loading}>Loading {tab}…</div>:null}

   {tab==='overview'?<section className={styles.overview}>
    <div className={styles.introCard}><span>FAST BY DEFAULT</span><h2>Load only what you open</h2><p>The overview now loads summary counts only. Product tables, QR scans and exception records are fetched only when you open those tabs.</p></div>
    <div className={styles.quickGrid}>
     <a href="/admin/data"><strong>Import / refresh data</strong><span>Run official and Cannlytics source imports.</span></a>
     <button type="button" onClick={()=>void openTab('exceptions')}><strong>Review exceptions</strong><span>{attention.toLocaleString()} records currently need a category or QR linkage.</span></button>
     <a href="/admin/product-maintenance"><strong>Product maintenance</strong><span>Edit an obvious product mistake or merge a real duplicate.</span></a>
     <a href="#advanced-tools"><strong>Advanced tools</strong><span>Manual category and legacy maintenance tools.</span></a>
    </div>
    <div className={styles.healthGrid}>
     <div><strong>{data.stats.categorizedProducts.toLocaleString()}</strong><span>Categorized automatically</span></div>
     <div><strong>{data.stats.qrScanEvents.toLocaleString()}</strong><span>Total QR scan events</span></div>
     <div><strong>{data.stats.menuItems.toLocaleString()}</strong><span>Active menu links</span></div>
     <div><strong>{data.stats.storesWithMenus.toLocaleString()}</strong><span>Stores with menus</span></div>
    </div>
   </section>:null}

   {tab==='products'&&loaded.products?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>CATALOG</span><h2>Products</h2><p>{query?`Search results for “${query}”.`:'Latest 150 products. Search to find anything else in the catalog.'}</p></div><a href="/admin/product-maintenance">Edit / merge products →</a></div>
    {data.products.length===0?<div className={styles.empty}>No products match this search.</div>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Product</th><th>Status</th><th>Category</th><th>Batches</th><th>Identifiers</th></tr></thead><tbody>{data.products.map(product=>{const verified=verifiedById.get(product.id);return <tr key={product.id}><td><a className={styles.primaryLink} href={`/product/${encodeURIComponent(product.id)}`} target="_blank">{product.brand_name?`${product.brand_name} · `:''}{product.product_name}</a><small>{[product.net_contents,product.product_type].filter(Boolean).join(' · ')||'—'}</small></td><td>{verified?<><b className={styles.good}>✓ Lab verified</b><small>{Number(verified.verified_batch_count||0).toLocaleString()} verified batch{Number(verified.verified_batch_count||0)===1?'':'es'}</small></>:<><b className={styles.neutral}>Imported</b><small>Source-backed product</small></>}</td><td>{product.category_name||<b className={styles.warn}>Needs category</b>}</td><td>{Number(product.batch_count||0).toLocaleString()}</td><td><span>{product.barcode||'—'}</span><small>{Number(product.menu_count||0).toLocaleString()} menu link{Number(product.menu_count||0)===1?'':'s'}</small></td></tr>;})}</tbody></table></div>}
   </section>:null}

   {tab==='scans'&&loaded.scans?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>QR ACTIVITY</span><h2>QR scans</h2><p>Newest 250 scans. Search runs on the server instead of downloading the entire scan table.</p></div><span>{data.qrScans.length.toLocaleString()} shown</span></div>
    {data.qrScans.length===0?<div className={styles.empty}>No QR scans match this search.</div>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>QR / source</th><th>Product</th><th>Batch / COA</th><th>Status</th><th>Activity</th></tr></thead><tbody>{data.qrScans.map(row=>{const productName=row.canonical_product_name||row.product_name||row.title||'Unlinked QR';const brand=row.canonical_brand_name||row.brand_name;return <tr key={row.id}><td>{isHttp(row.qr_value)?<a className={styles.primaryLink} href={row.qr_value} target="_blank" rel="noreferrer">{compact(row.qr_value)}</a>:<code>{compact(row.qr_value)}</code>}<small>{[row.qr_host,row.resolver].filter(Boolean).join(' · ')||'—'}</small></td><td>{row.product_id?<a className={styles.primaryLink} href={`/product/${encodeURIComponent(row.product_id)}`} target="_blank">{brand?`${brand} · `:''}{productName}</a>:<span>{brand?`${brand} · `:''}{productName}</span>}<small>{[row.canonical_category_name,row.canonical_net_contents].filter(Boolean).join(' · ')||'—'}</small></td><td><code>{row.uid||row.batch_number||'—'}</code><small>{row.coa_number?`COA ${row.coa_number}`:'—'}</small></td><td>{row.verified_lab_batch?<b className={styles.good}>✓ Verified</b>:row.product_id&&row.batch_id?<b className={styles.neutral}>Linked</b>:<b className={styles.warn}>Needs linkage</b>}<small>{row.overall_status||row.canonical_lab_name||row.lab_name||'—'}</small></td><td>{Number(row.scan_count||0).toLocaleString()}<small>{dateTime(row.last_seen_at)}</small></td></tr>;})}</tbody></table></div>}
   </section>:null}

   {tab==='exceptions'&&loaded.exceptions?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>ACTIONABLE ONLY</span><h2>Exceptions</h2><p>Only the first 50 records from each actionable queue are loaded. Search to narrow further.</p></div></div>
    <div className={styles.exceptionGrid}>
     <article><div className={styles.exceptionTitle}><strong>Unlinked QR codes</strong><span>{data.stats.unlinkedQrs.toLocaleString()} total</span></div>{data.unlinkedQrScans.length===0?<p>No unlinked QR codes match this search.</p>:<div className={styles.exceptionList}>{data.unlinkedQrScans.map(row=><div key={row.id}><div><strong>{compact(row.canonical_product_name||row.product_name||row.title||row.qr_value,72)}</strong><small>{compact(row.qr_value,80)}</small></div><b>{!row.product_id?'No product':'No batch'}</b></div>)}</div>}</article>
     <article><div className={styles.exceptionTitle}><strong>Products without category</strong><span>{data.stats.uncategorizedProducts.toLocaleString()} total</span></div>{data.uncategorizedProducts.length===0?<p>No uncategorized products match this search.</p>:<div className={styles.exceptionList}>{data.uncategorizedProducts.map(product=><div key={product.id}><div><a className={styles.primaryLink} href={`/product/${encodeURIComponent(product.id)}`} target="_blank">{product.brand_name?`${product.brand_name} · `:''}{product.product_name}</a><small>{Number(product.batch_count||0).toLocaleString()} batch{Number(product.batch_count||0)===1?'':'es'}</small></div><b>Category</b></div>)}</div>}</article>
    </div>
   </section>:null}
  </section>
 </main>;
}
