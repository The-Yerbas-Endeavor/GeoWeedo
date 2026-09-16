'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import styles from './AdminProductsMenus.module.css';

type Tab='overview'|'products'|'scans'|'exceptions';
type Product={id:string;brand_name:string|null;product_name:string;product_type:string|null;category_name:string|null;net_contents:string|null;barcode:string|null;batch_count:number;menu_count:number};
type VerifiedProduct={id:string;verified_batch_count:number;qr_count:number;qr_scan_events:number;latest_uid:string|null;latest_coa_number:string|null;latest_lab_name:string|null;latest_status:string|null;latest_tested_at:string|null};
type QrScan={id:string;qr_value:string;qr_host:string|null;resolver:string;product_id:string|null;batch_id:string|null;title:string|null;brand_name:string|null;product_name:string|null;canonical_brand_name:string|null;canonical_product_name:string|null;canonical_category_name:string|null;canonical_product_type:string|null;canonical_net_contents:string|null;batch_number:string|null;uid:string|null;coa_number:string|null;overall_status:string|null;canonical_lab_name:string|null;lab_name:string|null;last_seen_at:string;scan_count:number;verified_lab_batch:number};
type Stats={products:number;categorizedProducts:number;uncategorizedProducts:number;verifiedProducts:number;verifiedBatches:number;qrCodes:number;qrScanEvents:number;unlinkedQrs:number;menuItems:number;storesWithMenus:number};
type Catalog={total:number;page:number;pageSize:number;pageCount:number;sort:string};
type Payload={stats:Stats;catalog:Catalog;products:Product[];verifiedProducts:VerifiedProduct[];qrScans:QrScan[]};

const emptyStats:Stats={products:0,categorizedProducts:0,uncategorizedProducts:0,verifiedProducts:0,verifiedBatches:0,qrCodes:0,qrScanEvents:0,unlinkedQrs:0,menuItems:0,storesWithMenus:0};
const emptyCatalog:Catalog={total:0,page:1,pageSize:50,pageCount:1,sort:'updated_desc'};
const sortOptions=[
 ['updated_desc','Recently updated'],['updated_asc','Oldest updated'],['name_asc','Product name A–Z'],['name_desc','Product name Z–A'],
 ['brand_asc','Brand A–Z'],['brand_desc','Brand Z–A'],['batches_desc','Most batches'],['menus_desc','Most menu links'],
] as const;
function dateTime(value:string|null|undefined){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString();}
function compact(value:string|null|undefined,max=64){const text=String(value||'').trim();return text.length>max?`${text.slice(0,max-1)}…`:text||'—';}
function isHttp(value:string){return /^https?:\/\//i.test(value);}

export default function AdminProductsMenus(){
 const[data,setData]=useState<Payload>({stats:emptyStats,catalog:emptyCatalog,products:[],verifiedProducts:[],qrScans:[]});
 const[tab,setTab]=useState<Tab>('overview');
 const[query,setQuery]=useState('');
 const[sort,setSort]=useState('updated_desc');
 const[pageSize,setPageSize]=useState(50);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState('');

 async function load(q='',page=1,sortValue=sort,pageSizeValue=pageSize){
  const params=new URLSearchParams();
  if(q.trim())params.set('q',q.trim());
  params.set('page',String(page));params.set('pageSize',String(pageSizeValue));params.set('sort',sortValue);
  const response=await fetch(`/api/admin/products-menus?${params}`,{cache:'no-store'});
  if(response.status===401){window.location.href='/admin/login';return;}
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Could not load GeoWeedo Facts data.');
  const catalog={...emptyCatalog,...(body.catalog||{})};
  setSort(String(catalog.sort||sortValue));
  setPageSize(Number(catalog.pageSize||pageSizeValue));
  setData({stats:{...emptyStats,...(body.stats||{})},catalog,products:Array.isArray(body.products)?body.products:[],verifiedProducts:Array.isArray(body.verifiedProducts)?body.verifiedProducts:[],qrScans:Array.isArray(body.qrScans)?body.qrScans:[]});
 }

 useEffect(()=>{load('',1,'updated_desc',50).catch(err=>setError(err instanceof Error?err.message:'Load failed.')).finally(()=>setLoading(false));},[]);

 async function search(event:FormEvent){event.preventDefault();setLoading(true);setError('');try{await load(query,1,sort,pageSize);setTab('products');}catch(err){setError(err instanceof Error?err.message:'Search failed.');}finally{setLoading(false);}}
 function clearSearch(){setQuery('');setLoading(true);setError('');load('',1,sort,pageSize).catch(err=>setError(err instanceof Error?err.message:'Load failed.')).finally(()=>setLoading(false));}
 async function goPage(page:number){setLoading(true);setError('');try{await load(query,page,sort,pageSize);}catch(err){setError(err instanceof Error?err.message:'Could not load product page.');}finally{setLoading(false);}}
 async function changeSort(value:string){setSort(value);setLoading(true);setError('');try{await load(query,1,value,pageSize);}catch(err){setError(err instanceof Error?err.message:'Could not sort products.');}finally{setLoading(false);}}
 async function changePageSize(value:number){setPageSize(value);setLoading(true);setError('');try{await load(query,1,sort,value);}catch(err){setError(err instanceof Error?err.message:'Could not change page size.');}finally{setLoading(false);}}

 const verifiedById=useMemo(()=>new Map(data.verifiedProducts.map(row=>[row.id,row])),[data.verifiedProducts]);
 const normalizedQuery=query.trim().toLowerCase();
 const filteredScans=useMemo(()=>{
  if(!normalizedQuery)return data.qrScans;
  return data.qrScans.filter(row=>[row.qr_value,row.qr_host,row.resolver,row.canonical_brand_name,row.canonical_product_name,row.canonical_category_name,row.product_name,row.batch_number,row.uid,row.coa_number,row.canonical_lab_name,row.lab_name,row.overall_status].some(v=>String(v||'').toLowerCase().includes(normalizedQuery)));
 },[data.qrScans,normalizedQuery]);
 const unlinkedScans=useMemo(()=>filteredScans.filter(row=>!row.product_id||!row.batch_id),[filteredScans]);
 const uncategorizedProducts=useMemo(()=>data.products.filter(row=>!row.category_name),[data.products]);
 const attention=data.stats.unlinkedQrs+data.stats.uncategorizedProducts;
 const catalogStart=data.catalog.total?((data.catalog.page-1)*data.catalog.pageSize)+1:0;
 const catalogEnd=Math.min(data.catalog.total,data.catalog.page*data.catalog.pageSize);

 if(loading&&data.stats.products===0)return <main className={styles.shell}><div className={styles.loading}>Loading GeoWeedo Facts…</div></main>;

 return <main className={styles.shell}>
  <header className={styles.header}>
   <div><span>GEOWEEDO FACTS · PRODUCT DATABASE</span><h1>Products & scans</h1><p>Search the full product catalog, inspect known facts, and connect products to GeoWeedo workflows without loading thousands of records at once.</p></div>
   <a href="/admin">← Admin</a>
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
     {([['overview','Overview'],['products','Products'],['scans','QR scans'],['exceptions','Exceptions']] as [Tab,string][]).map(([id,label])=><button key={id} type="button" className={tab===id?styles.activeTab:''} onClick={()=>setTab(id)}>{label}</button>)}
    </nav>
    <form className={styles.search} onSubmit={search}>
     <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search brand, product, category or package…" aria-label="Search product catalog"/>
     <button type="submit" disabled={loading}>{loading?'Loading…':'Search'}</button>
     {query?<button type="button" className={styles.clearButton} onClick={clearSearch}>Clear</button>:null}
    </form>
   </div>

   {tab==='overview'?<section className={styles.overview}>
    <div className={styles.introCard}><span>AUTOMATIC FIRST</span><h2>Imports should do the work</h2><p>GeoWeedo creates and links source-backed records automatically. Use this screen to search the catalog and investigate actual exceptions—not to manually approve normal imports.</p></div>
    <div className={styles.quickGrid}>
     <a href="#cannlytics-importer"><strong>Cannlytics product data</strong><span>Import or refresh product, batch, COA and lab facts below.</span></a>
     <button type="button" onClick={()=>setTab('products')}><strong>Browse products</strong><span>Search, sort and page through the complete product catalog.</span></button>
     <button type="button" onClick={()=>setTab('exceptions')}><strong>Review exceptions</strong><span>{attention.toLocaleString()} records currently need a category or QR linkage.</span></button>
     <a href="/admin/product-maintenance"><strong>Advanced maintenance</strong><span>Edit an obvious product mistake or merge a real duplicate.</span></a>
    </div>
    <div className={styles.healthGrid}>
     <div><strong>{data.stats.categorizedProducts.toLocaleString()}</strong><span>Categorized automatically</span></div>
     <div><strong>{data.stats.qrScanEvents.toLocaleString()}</strong><span>Total QR scan events</span></div>
     <div><strong>{data.stats.menuItems.toLocaleString()}</strong><span>Active menu links</span></div>
     <div><strong>{data.stats.storesWithMenus.toLocaleString()}</strong><span>Stores with menus</span></div>
    </div>
   </section>:null}

   {tab==='products'?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>CATALOG</span><h2>Products</h2><p>{query?`${data.catalog.total.toLocaleString()} matches for “${query}”.`:`${data.catalog.total.toLocaleString()} products in the catalog.`}</p></div><a href="/admin/product-maintenance">Edit / merge products →</a></div>
    <div className={styles.catalogBar}>
     <div><strong>{catalogStart.toLocaleString()}–{catalogEnd.toLocaleString()}</strong><span> of {data.catalog.total.toLocaleString()}</span></div>
     <div className={styles.catalogControls}>
      <label>Sort<select value={sort} disabled={loading} onChange={e=>changeSort(e.target.value)}>{sortOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Per page<select value={pageSize} disabled={loading} onChange={e=>changePageSize(Number(e.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
     </div>
    </div>
    {data.products.length===0?<div className={styles.empty}>No products match this search.</div>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Product</th><th>Status</th><th>Category</th><th>Batches</th><th>Identifiers</th></tr></thead><tbody>{data.products.map(product=>{const verified=verifiedById.get(product.id);return <tr key={product.id}><td><a className={styles.primaryLink} href={`/product/${encodeURIComponent(product.id)}`} target="_blank">{product.brand_name?`${product.brand_name} · `:''}{product.product_name}</a><small>{[product.net_contents,product.product_type].filter(Boolean).join(' · ')||'—'}</small></td><td>{verified?<><b className={styles.good}>✓ Lab verified</b><small>{Number(verified.verified_batch_count||0).toLocaleString()} verified batch{Number(verified.verified_batch_count||0)===1?'':'es'}</small></>:<><b className={styles.neutral}>Imported</b><small>Source-backed product</small></>}</td><td>{product.category_name||<b className={styles.warn}>Needs category</b>}</td><td>{Number(product.batch_count||0).toLocaleString()}</td><td><span>{product.barcode||'—'}</span><small>{Number(product.menu_count||0).toLocaleString()} menu link{Number(product.menu_count||0)===1?'':'s'}</small></td></tr>;})}</tbody></table></div>}
    <div className={styles.pagination}>
     <span>Page {data.catalog.page.toLocaleString()} of {data.catalog.pageCount.toLocaleString()}</span>
     <div><button type="button" disabled={loading||data.catalog.page<=1} onClick={()=>goPage(1)}>First</button><button type="button" disabled={loading||data.catalog.page<=1} onClick={()=>goPage(data.catalog.page-1)}>Previous</button><button type="button" disabled={loading||data.catalog.page>=data.catalog.pageCount} onClick={()=>goPage(data.catalog.page+1)}>Next</button><button type="button" disabled={loading||data.catalog.page>=data.catalog.pageCount} onClick={()=>goPage(data.catalog.pageCount)}>Last</button></div>
    </div>
   </section>:null}

   {tab==='scans'?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>QR ACTIVITY</span><h2>QR scans</h2><p>Newest scans first. Linked and verified records require no manual action.</p></div><span>{filteredScans.length.toLocaleString()} shown</span></div>
    {filteredScans.length===0?<div className={styles.empty}>No QR scans match this search.</div>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>QR / source</th><th>Product</th><th>Batch / COA</th><th>Status</th><th>Activity</th></tr></thead><tbody>{filteredScans.slice(0,250).map(row=>{const productName=row.canonical_product_name||row.product_name||row.title||'Unlinked QR';const brand=row.canonical_brand_name||row.brand_name;return <tr key={row.id}><td>{isHttp(row.qr_value)?<a className={styles.primaryLink} href={row.qr_value} target="_blank" rel="noreferrer">{compact(row.qr_value)}</a>:<code>{compact(row.qr_value)}</code>}<small>{[row.qr_host,row.resolver].filter(Boolean).join(' · ')||'—'}</small></td><td>{row.product_id?<a className={styles.primaryLink} href={`/product/${encodeURIComponent(row.product_id)}`} target="_blank">{brand?`${brand} · `:''}{productName}</a>:<span>{brand?`${brand} · `:''}{productName}</span>}<small>{[row.canonical_category_name,row.canonical_net_contents].filter(Boolean).join(' · ')||'—'}</small></td><td><code>{row.uid||row.batch_number||'—'}</code><small>{row.coa_number?`COA ${row.coa_number}`:'—'}</small></td><td>{row.verified_lab_batch?<b className={styles.good}>✓ Verified</b>:row.product_id&&row.batch_id?<b className={styles.neutral}>Linked</b>:<b className={styles.warn}>Needs linkage</b>}<small>{row.overall_status||row.canonical_lab_name||row.lab_name||'—'}</small></td><td>{Number(row.scan_count||0).toLocaleString()}<small>{dateTime(row.last_seen_at)}</small></td></tr>;})}</tbody></table></div>}
   </section>:null}

   {tab==='exceptions'?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>ACTIONABLE ONLY</span><h2>Exceptions</h2><p>These are the records worth looking at. Normal imported products and owner candidates are intentionally excluded.</p></div></div>
    <div className={styles.exceptionGrid}>
     <article><div className={styles.exceptionTitle}><strong>Unlinked QR codes</strong><span>{data.stats.unlinkedQrs.toLocaleString()} total</span></div>{unlinkedScans.length===0?<p>No unlinked QR codes match this search.</p>:<div className={styles.exceptionList}>{unlinkedScans.slice(0,50).map(row=><div key={row.id}><div><strong>{compact(row.canonical_product_name||row.product_name||row.title||row.qr_value,72)}</strong><small>{compact(row.qr_value,80)}</small></div><b>{!row.product_id?'No product':'No batch'}</b></div>)}</div>}</article>
     <article><div className={styles.exceptionTitle}><strong>Products without category</strong><span>{data.stats.uncategorizedProducts.toLocaleString()} total</span></div>{uncategorizedProducts.length===0?<p>No uncategorized products are on this catalog page.</p>:<div className={styles.exceptionList}>{uncategorizedProducts.slice(0,50).map(product=><div key={product.id}><div><a className={styles.primaryLink} href={`/product/${encodeURIComponent(product.id)}`} target="_blank">{product.brand_name?`${product.brand_name} · `:''}{product.product_name}</a><small>{Number(product.batch_count||0).toLocaleString()} batch{Number(product.batch_count||0)===1?'':'es'}</small></div><b>Category</b></div>)}</div>}</article>
    </div>
   </section>:null}
  </section>
 </main>;
}
