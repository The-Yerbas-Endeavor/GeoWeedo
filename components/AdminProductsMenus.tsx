'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import styles from './AdminProductsMenus.module.css';

type Tab='products'|'scans'|'exceptions';
type Product={id:string;brand_name:string|null;product_name:string;product_type:string|null;category_name:string|null;net_contents:string|null;barcode:string|null;batch_count:number;menu_count:number};
type VerifiedProduct={id:string;verified_batch_count:number;qr_count:number;qr_scan_events:number;latest_uid:string|null;latest_coa_number:string|null;latest_lab_name:string|null;latest_status:string|null;latest_tested_at:string|null};
type QrScan={id:string;qr_value:string;qr_host:string|null;resolver:string;product_id:string|null;batch_id:string|null;title:string|null;brand_name:string|null;product_name:string|null;canonical_brand_name:string|null;canonical_product_name:string|null;canonical_category_name:string|null;canonical_product_type:string|null;canonical_net_contents:string|null;batch_number:string|null;uid:string|null;coa_number:string|null;overall_status:string|null;canonical_lab_name:string|null;lab_name:string|null;last_seen_at:string;scan_count:number;verified_lab_batch:number};
type Dispensary={id:string;name:string;city:string|null;region:string|null;country:string|null};
type Stats={products:number;categorizedProducts:number;uncategorizedProducts:number;verifiedProducts:number;verifiedBatches:number;qrCodes:number;qrScanEvents:number;unlinkedQrs:number;menuItems:number;storesWithMenus:number};
type Payload={stats:Stats;products:Product[];verifiedProducts:VerifiedProduct[];qrScans:QrScan[];dispensaries:Dispensary[]};
type LinkProduct={id:string;brand_name:string|null;product_name:string;product_type:string|null;category_name:string|null;net_contents:string|null;menu_count:number};

const emptyStats:Stats={products:0,categorizedProducts:0,uncategorizedProducts:0,verifiedProducts:0,verifiedBatches:0,qrCodes:0,qrScanEvents:0,unlinkedQrs:0,menuItems:0,storesWithMenus:0};
function dateTime(value:string|null|undefined){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString();}
function compact(value:string|null|undefined,max=64){const text=String(value||'').trim();return text.length>max?`${text.slice(0,max-1)}…`:text||'—';}
function isHttp(value:string){return /^https?:\/\//i.test(value);}
function productLabel(product:LinkProduct){return `${product.brand_name?`${product.brand_name} · `:''}${product.product_name}`;}

export default function AdminProductsMenus(){
 const[data,setData]=useState<Payload>({stats:emptyStats,products:[],verifiedProducts:[],qrScans:[],dispensaries:[]});
 const[tab,setTab]=useState<Tab>('products');
 const[query,setQuery]=useState('');
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState('');
 const[notice,setNotice]=useState('');
 const[linkProduct,setLinkProduct]=useState<LinkProduct|null>(null);
 const[dispensaryQuery,setDispensaryQuery]=useState('');
 const[dispensaryId,setDispensaryId]=useState('');
 const[price,setPrice]=useState('');
 const[packageSize,setPackageSize]=useState('');
 const[linking,setLinking]=useState(false);

 async function load(q=''){
  const params=new URLSearchParams();if(q.trim())params.set('q',q.trim());
  const response=await fetch(`/api/admin/products-menus${params.size?`?${params}`:''}`,{cache:'no-store'});
  if(response.status===401){window.location.href='/admin/login';return;}
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Could not load GeoWeedo Facts data.');
  setData({stats:{...emptyStats,...(body.stats||{})},products:Array.isArray(body.products)?body.products:[],verifiedProducts:Array.isArray(body.verifiedProducts)?body.verifiedProducts:[],qrScans:Array.isArray(body.qrScans)?body.qrScans:[],dispensaries:Array.isArray(body.dispensaries)?body.dispensaries:[]});
 }

 useEffect(()=>{load().catch(err=>setError(err instanceof Error?err.message:'Load failed.')).finally(()=>setLoading(false));},[]);

 async function search(event:FormEvent){event.preventDefault();setLoading(true);setError('');setNotice('');try{await load(query);}catch(err){setError(err instanceof Error?err.message:'Search failed.');}finally{setLoading(false);}}
 function clearSearch(){setQuery('');setLoading(true);setError('');load('').catch(err=>setError(err instanceof Error?err.message:'Load failed.')).finally(()=>setLoading(false));}

 const verifiedById=useMemo(()=>new Map(data.verifiedProducts.map(row=>[row.id,row])),[data.verifiedProducts]);
 const normalizedQuery=query.trim().toLowerCase();
 const filteredScans=useMemo(()=>{
  if(!normalizedQuery)return data.qrScans;
  return data.qrScans.filter(row=>[row.qr_value,row.qr_host,row.resolver,row.canonical_brand_name,row.canonical_product_name,row.canonical_category_name,row.product_name,row.batch_number,row.uid,row.coa_number,row.canonical_lab_name,row.lab_name,row.overall_status].some(v=>String(v||'').toLowerCase().includes(normalizedQuery)));
 },[data.qrScans,normalizedQuery]);
 const unlinkedScans=useMemo(()=>filteredScans.filter(row=>!row.product_id),[filteredScans]);
 const filteredDispensaries=useMemo(()=>{
  const q=dispensaryQuery.trim().toLowerCase();
  const rows=q?data.dispensaries.filter(row=>[row.name,row.city,row.region,row.country].some(v=>String(v||'').toLowerCase().includes(q))):data.dispensaries;
  return rows.slice(0,150);
 },[data.dispensaries,dispensaryQuery]);
 const selectedDispensary=useMemo(()=>data.dispensaries.find(row=>row.id===dispensaryId)||null,[data.dispensaries,dispensaryId]);

 function openLink(product:LinkProduct){
  setLinkProduct(product);setDispensaryQuery('');setDispensaryId('');setPrice('');setPackageSize(product.net_contents||'');setError('');setNotice('');
 }

 function openLinkFromScan(row:QrScan){
  if(!row.product_id)return;
  openLink({
   id:row.product_id,
   brand_name:row.canonical_brand_name||row.brand_name||null,
   product_name:row.canonical_product_name||row.product_name||row.title||'Scanned product',
   product_type:row.canonical_product_type||null,
   category_name:row.canonical_category_name||null,
   net_contents:row.canonical_net_contents||null,
   menu_count:0,
  });
 }

 async function addToDispensary(event:FormEvent){
  event.preventDefault();
  if(!linkProduct||!dispensaryId)return;
  setLinking(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/admin/products-menus',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    action:'add-menu-item',dispensaryId,productId:linkProduct.id,itemName:linkProduct.product_name,brandName:linkProduct.brand_name,
    category:linkProduct.product_type,categoryId:null,packageSize:packageSize.trim()||linkProduct.net_contents||null,price:price.trim()||null,
    inventoryStatus:'in_stock',
   })});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Could not add product to dispensary.');
   const store=selectedDispensary?.name||'dispensary';
   setNotice(body.alreadyLinked?`${productLabel(linkProduct)} is already linked to ${store}.`:`Added ${productLabel(linkProduct)} to ${store}.`);
   setLinkProduct(null);setDispensaryId('');setDispensaryQuery('');setPrice('');setPackageSize('');
   await load(query);
  }catch(err){setError(err instanceof Error?err.message:'Could not add product to dispensary.');}
  finally{setLinking(false);}
 }

 async function findProductFromScan(row:QrScan){
  const term=String(row.canonical_product_name||row.product_name||row.title||'').trim();
  if(!term)return;
  setQuery(term);setTab('products');setLoading(true);setError('');
  try{await load(term);}catch(err){setError(err instanceof Error?err.message:'Could not search products.');}finally{setLoading(false);}
 }

 if(loading&&data.stats.products===0)return <main className={styles.shell}><div className={styles.loading}>Loading product library…</div></main>;

 return <main className={styles.shell}>
  <header className={styles.header}>
   <div><span>GEOWEEDO FACTS · PRODUCT LIBRARY</span><h1>Products & dispensaries</h1><p>Find a product, confirm its known facts, and add it to a dispensary menu. Cleanup tools stay out of the way unless you actually need them.</p></div>
   <a href="/admin">← Admin</a>
  </header>

  <section className={styles.summary}>
   <article><strong>{data.stats.products.toLocaleString()}</strong><span>Known products</span></article>
   <article><strong>{data.stats.verifiedProducts.toLocaleString()}</strong><span>Lab verified</span></article>
   <article><strong>{data.stats.menuItems.toLocaleString()}</strong><span>Menu links</span></article>
   <article><strong>{data.stats.storesWithMenus.toLocaleString()}</strong><span>Dispensaries with menus</span></article>
  </section>

  {error?<div className={styles.error}>{error}</div>:null}
  {notice?<div className={styles.notice}>{notice}</div>:null}

  <section className={styles.workspace}>
   <div className={styles.toolbar}>
    <nav className={styles.tabs} aria-label="Product database sections">
     {([['products','Products'],['scans','Scans'],['exceptions','Needs attention']] as [Tab,string][]).map(([id,label])=><button key={id} type="button" className={tab===id?styles.activeTab:''} onClick={()=>setTab(id)}>{label}</button>)}
    </nav>
    <form className={styles.search} onSubmit={search}>
     <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search brand, product, category, UID, COA or QR…" aria-label="Search product library"/>
     <button type="submit" disabled={loading}>{loading?'Searching…':'Search'}</button>
     {query?<button type="button" className={styles.clearButton} onClick={clearSearch}>Clear</button>:null}
    </form>
   </div>

   {linkProduct?<section className={styles.linkPanel} aria-label="Add product to dispensary">
    <div className={styles.linkPanelHead}><div><span>ADD TO DISPENSARY</span><h2>{productLabel(linkProduct)}</h2><p>{[linkProduct.category_name||linkProduct.product_type,linkProduct.net_contents].filter(Boolean).join(' · ')||'Known GeoWeedo product'}</p></div><button type="button" onClick={()=>setLinkProduct(null)}>Close</button></div>
    <form className={styles.linkForm} onSubmit={addToDispensary}>
     <label>Find dispensary<input value={dispensaryQuery} onChange={e=>{setDispensaryQuery(e.target.value);setDispensaryId('');}} placeholder="Search dispensary, city or state…"/></label>
     <label>Dispensary<select required value={dispensaryId} onChange={e=>setDispensaryId(e.target.value)}><option value="">Choose dispensary…</option>{filteredDispensaries.map(store=><option key={store.id} value={store.id}>{store.name}{store.city?` · ${store.city}`:''}{store.region?`, ${store.region}`:''}</option>)}</select><small>{filteredDispensaries.length.toLocaleString()} shown{data.dispensaries.length>filteredDispensaries.length?' · type to narrow':''}</small></label>
     <label>Package size <span>optional</span><input value={packageSize} onChange={e=>setPackageSize(e.target.value)} placeholder="3.5 g, 1 pack, 100 mg…"/></label>
     <label>Price <span>optional</span><input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} placeholder="0.00"/></label>
     <button type="submit" className={styles.primaryAction} disabled={linking||!dispensaryId}>{linking?'Adding…':'Add product to menu'}</button>
    </form>
    <p className={styles.linkHelp}>This links the exact canonical product to the dispensary. The public product page can then show that store through “Find this product near me.”</p>
   </section>:null}

   {tab==='products'?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>PRODUCT LIBRARY</span><h2>Known products</h2><p>{query?`Search results for “${query}”.`:'Latest 150 products. Search by brand or product name to find anything else.'}</p></div><span>{data.products.length.toLocaleString()} shown</span></div>
    {data.products.length===0?<div className={styles.empty}>No products match this search.</div>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Product</th><th>Known facts</th><th>Dispensary availability</th><th>Action</th></tr></thead><tbody>{data.products.map(product=>{const verified=verifiedById.get(product.id);return <tr key={product.id}>
     <td><a className={styles.primaryLink} href={`/product/${encodeURIComponent(product.id)}`} target="_blank">{product.brand_name?`${product.brand_name} · `:''}{product.product_name}</a><small>{[product.category_name||product.product_type,product.net_contents].filter(Boolean).join(' · ')||'—'}</small></td>
     <td>{verified?<><b className={styles.good}>✓ Lab verified</b><small>{Number(verified.verified_batch_count||0).toLocaleString()} verified batch{Number(verified.verified_batch_count||0)===1?'':'es'} · {Number(product.batch_count||0).toLocaleString()} total</small></>:<><b className={styles.neutral}>Known product</b><small>{Number(product.batch_count||0).toLocaleString()} batch{Number(product.batch_count||0)===1?'':'es'} on file</small></>}</td>
     <td>{Number(product.menu_count||0)>0?<><b className={styles.good}>{Number(product.menu_count||0).toLocaleString()} active menu link{Number(product.menu_count||0)===1?'':'s'}</b><small><a className={styles.primaryLink} href={`/?product=${encodeURIComponent(product.id)}`} target="_blank">View availability</a></small></>:<><b className={styles.neutral}>Not linked yet</b><small>Add it to a dispensary when you see it on the menu.</small></>}</td>
     <td><div className={styles.rowActions}><button type="button" className={styles.primaryAction} onClick={()=>openLink(product)}>Add to dispensary</button><a href={`/product/${encodeURIComponent(product.id)}`} target="_blank">View facts</a></div></td>
    </tr>;})}</tbody></table></div>}
   </section>:null}

   {tab==='scans'?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>SCANNED PRODUCTS</span><h2>Scans</h2><p>A scan linked to a known product can be added directly to a dispensary menu.</p></div><span>{filteredScans.length.toLocaleString()} shown</span></div>
    {filteredScans.length===0?<div className={styles.empty}>No scans match this search.</div>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Scan</th><th>Matched product</th><th>Facts</th><th>Action</th></tr></thead><tbody>{filteredScans.slice(0,250).map(row=>{const productName=row.canonical_product_name||row.product_name||row.title||'Unlinked scan';const brand=row.canonical_brand_name||row.brand_name;return <tr key={row.id}>
     <td>{isHttp(row.qr_value)?<a className={styles.primaryLink} href={row.qr_value} target="_blank" rel="noreferrer">{compact(row.qr_value)}</a>:<code>{compact(row.qr_value)}</code>}<small>{[row.qr_host,row.resolver].filter(Boolean).join(' · ')||dateTime(row.last_seen_at)}</small></td>
     <td>{row.product_id?<a className={styles.primaryLink} href={`/product/${encodeURIComponent(row.product_id)}`} target="_blank">{brand?`${brand} · `:''}{productName}</a>:<span>{brand?`${brand} · `:''}{productName}</span>}<small>{[row.canonical_category_name,row.canonical_net_contents].filter(Boolean).join(' · ')||'—'}</small></td>
     <td>{row.verified_lab_batch?<><b className={styles.good}>✓ Verified lab batch</b><small>{row.uid||row.batch_number||row.coa_number||'Linked batch'}</small></>:row.product_id?<><b className={styles.neutral}>Known product</b><small>{row.batch_id?'Batch linked':'Product linked'}</small></>:<><b className={styles.warn}>No product match</b><small>Find the canonical product first.</small></>}</td>
     <td><div className={styles.rowActions}>{row.product_id?<><button type="button" className={styles.primaryAction} onClick={()=>openLinkFromScan(row)}>Add to dispensary</button><a href={`/product/${encodeURIComponent(row.product_id)}`} target="_blank">View facts</a></>:<button type="button" onClick={()=>findProductFromScan(row)}>Find product</button>}</div></td>
    </tr>;})}</tbody></table>{filteredScans.length>250?<div className={styles.tableNote}>Showing newest 250. Search to narrow the list.</div>:null}</div>}
   </section>:null}

   {tab==='exceptions'?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>ACTIONABLE ONLY</span><h2>Scans without a product match</h2><p>Only scans that cannot yet connect to a known product are shown here. Imported owner/category cleanup is not part of this workflow.</p></div><span>{data.stats.unlinkedQrs.toLocaleString()} QR records need linkage</span></div>
    {unlinkedScans.length===0?<div className={styles.empty}>No unlinked scans match this search.</div>:<div className={styles.exceptionList}>{unlinkedScans.slice(0,100).map(row=><div key={row.id}><div><strong>{compact(row.product_name||row.title||row.qr_value,72)}</strong><small>{compact(row.qr_value,90)}</small></div><button type="button" onClick={()=>findProductFromScan(row)}>Find product</button></div>)}</div>}
   </section>:null}
  </section>

  <details className={styles.advanced}>
   <summary>Advanced cleanup tools</summary>
   <div><a href="/admin/product-maintenance">Product maintenance</a><span>Edit a canonical name or merge a true duplicate only when needed.</span></div>
   <div><a href="/admin/data">Data imports</a><span>Refresh source-backed product and lab data.</span></div>
  </details>
 </main>;
}
