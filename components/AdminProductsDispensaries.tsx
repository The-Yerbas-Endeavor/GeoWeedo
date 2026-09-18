'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import styles from './AdminProductsDispensaries.module.css';

type Tab = 'products' | 'matches' | 'scans' | 'exceptions';
type Stats = { products:number; scannedProducts:number; verifiedProducts:number; verifiedBatches:number; qrCodes:number; unlinkedQrs:number; menuItems:number; storesWithMenus:number };
type Catalog = { total:number; page:number; pageSize:number; pageCount:number; sort:string; scope:'scanned'|'reference' };
type Product = { id:string; brand_name:string|null; product_name:string; product_type:string|null; category_name:string|null; net_contents:string|null; batch_count:number; menu_count:number; scan_count:number; latest_scan_at:string|null };
type Verified = { id:string; verified_batch_count:number; latest_tested_at:string|null };
type Scan = { id:string; qr_value:string; qr_host:string|null; product_id:string|null; title:string|null; brand_name:string|null; product_name:string|null; canonical_brand_name:string|null; canonical_product_name:string|null; canonical_product_type:string|null; canonical_category_name:string|null; canonical_net_contents:string|null; batch_number:string|null; uid:string|null; coa_number:string|null; overall_status:string|null; canonical_lab_name:string|null; lab_name:string|null; last_seen_at:string; scan_count:number; verified_lab_batch:number };
type Store = { id:string; name:string; city:string|null; region:string|null; country:string|null };
type MenuMatchStats = { linked:number; needsReview:number; unmatched:number };
type MenuMatch = {
 item_id:string;item_name:string;menu_brand_name:string|null;package_size:string|null;category:string|null;
 price_cents:number|null;currency:string|null;inventory_status:string|null;source_url:string|null;
 match_confidence:string|null;match_score:number|null;match_reason:string|null;match_review_status:string|null;
 dispensary_id:string;dispensary_name:string;dispensary_city:string|null;dispensary_region:string|null;
 suggested_product_id:string;product_brand_name:string|null;product_name:string;product_type:string|null;net_contents:string|null;
};

type LinkProduct = Pick<Product,'id'|'brand_name'|'product_name'|'product_type'|'category_name'|'net_contents'|'menu_count'>;

const emptyStats:Stats={products:0,scannedProducts:0,verifiedProducts:0,verifiedBatches:0,qrCodes:0,unlinkedQrs:0,menuItems:0,storesWithMenus:0};
const emptyCatalog:Catalog={total:0,page:1,pageSize:50,pageCount:1,sort:'scanned_desc',scope:'scanned'};
const emptyMenuMatchStats:MenuMatchStats={linked:0,needsReview:0,unmatched:0};
const sortOptions=[['scanned_desc','Recently scanned'],['updated_desc','Recently updated'],['updated_asc','Oldest updated'],['name_asc','Product name A–Z'],['name_desc','Product name Z–A'],['brand_asc','Brand A–Z'],['brand_desc','Brand Z–A'],['batches_desc','Most batches'],['menus_desc','Most menu links']] as const;
const label=(p:LinkProduct)=>`${p.brand_name?`${p.brand_name} · `:''}${p.product_name}`;
const compact=(value:string|null|undefined,max=58)=>{const v=String(value||'').trim();return v.length>max?`${v.slice(0,max-1)}…`:v||'—';};

export default function AdminProductsDispensaries(){
 const[tab,setTab]=useState<Tab>('products');
 const[query,setQuery]=useState('');
 const[stats,setStats]=useState<Stats>(emptyStats);
 const[catalog,setCatalog]=useState<Catalog>(emptyCatalog);
 const[productScope,setProductScope]=useState<'scanned'|'reference'>('scanned');
 const[sort,setSort]=useState('scanned_desc');
 const[pageSize,setPageSize]=useState(50);
 const[products,setProducts]=useState<Product[]>([]);
 const[verified,setVerified]=useState<Verified[]>([]);
 const[scans,setScans]=useState<Scan[]>([]);
 const[menuMatches,setMenuMatches]=useState<MenuMatch[]>([]);
 const[menuMatchStats,setMenuMatchStats]=useState<MenuMatchStats>(emptyMenuMatchStats);
 const[matchBusy,setMatchBusy]=useState<string|null>(null);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState('');
 const[notice,setNotice]=useState('');

 const[linkProduct,setLinkProduct]=useState<LinkProduct|null>(null);
 const[stores,setStores]=useState<Store[]>([]);
 const[storeQuery,setStoreQuery]=useState('');
 const[storeId,setStoreId]=useState('');
 const[storeLoading,setStoreLoading]=useState(false);
 const[price,setPrice]=useState('');
 const[packageSize,setPackageSize]=useState('');
 const[linking,setLinking]=useState(false);

 const verifiedById=useMemo(()=>new Map(verified.map(row=>[row.id,row])),[verified]);
 const selectedStore=useMemo(()=>stores.find(row=>row.id===storeId)||null,[stores,storeId]);

 async function fetchView(view:Tab,q='',page=1,sortValue=sort,pageSizeValue=pageSize,scopeValue=productScope){
  const params=new URLSearchParams({view});
  if(q.trim())params.set('q',q.trim());
  if(view==='products'){
   params.set('page',String(page));
   params.set('pageSize',String(pageSizeValue));
   params.set('sort',sortValue);
   params.set('scope',scopeValue);
  }
  const response=await fetch(`/api/admin/products-menus?${params}`,{cache:'no-store'});
  if(response.status===401){window.location.href='/admin/login';return;}
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Could not load product data.');
  if(body.stats)setStats({...emptyStats,...body.stats});
  if(view==='products'){
   const nextCatalog={...emptyCatalog,...(body.catalog||{})};
   setCatalog(nextCatalog);
   setSort(String(nextCatalog.sort||sortValue));
   setProductScope(nextCatalog.scope==='reference'?'reference':'scanned');
   setPageSize(Number(nextCatalog.pageSize||pageSizeValue));
   setProducts(Array.isArray(body.products)?body.products:[]);
   setVerified(Array.isArray(body.verifiedProducts)?body.verifiedProducts:[]);
  }else if(view==='matches'){
   setMenuMatches(Array.isArray(body.menuMatches)?body.menuMatches:[]);
   setMenuMatchStats({...emptyMenuMatchStats,...(body.menuMatchStats||{})});
  }else{
   setScans(Array.isArray(body.qrScans)?body.qrScans:[]);
  }
 }

 async function load(view:Tab=tab,q=query,page=1,sortValue=sort,pageSizeValue=pageSize,scopeValue=productScope){
  setLoading(true);setError('');
  try{await fetchView(view,q,page,sortValue,pageSizeValue,scopeValue);}catch(err){setError(err instanceof Error?err.message:'Load failed.');}
  finally{setLoading(false);}
 }

 useEffect(()=>{load('products','',1,'scanned_desc',50,'scanned');},[]);

 async function changeTab(next:Tab){setTab(next);setQuery('');await load(next,'',1,sort,pageSize);}
 async function search(event:FormEvent){event.preventDefault();await load(tab,query,1,sort,pageSize);}
 async function clearSearch(){setQuery('');await load(tab,'',1,sort,pageSize);}
 async function goPage(page:number){await load('products',query,page,sort,pageSize,productScope);}
 async function changeSort(value:string){setSort(value);await load('products',query,1,value,pageSize,productScope);}
 async function changePageSize(value:number){setPageSize(value);await load('products',query,1,sort,value,productScope);}
 async function changeProductScope(scope:'scanned'|'reference'){
  const nextSort=scope==='scanned'?'scanned_desc':'updated_desc';
  setProductScope(scope);setSort(nextSort);setQuery('');
  await load('products','',1,nextSort,pageSize,scope);
 }

 async function findStores(event?:FormEvent){
  event?.preventDefault();
  setStoreLoading(true);setError('');
  try{
   const params=new URLSearchParams({view:'dispensaries'});if(storeQuery.trim())params.set('q',storeQuery.trim());
   const response=await fetch(`/api/admin/products-menus?${params}`,{cache:'no-store'});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Could not load dispensaries.');
   setStores(Array.isArray(body.dispensaries)?body.dispensaries:[]);setStoreId('');
  }catch(err){setError(err instanceof Error?err.message:'Could not load dispensaries.');}
  finally{setStoreLoading(false);}
 }

 function openLink(product:LinkProduct){
  setLinkProduct(product);setStoreQuery('');setStoreId('');setStores([]);setPrice('');setPackageSize(product.net_contents||'');setNotice('');setError('');
  setTimeout(()=>{findStores();},0);
 }

 function openLinkFromScan(row:Scan){
  if(!row.product_id)return;
  openLink({id:row.product_id,brand_name:row.canonical_brand_name||row.brand_name||null,product_name:row.canonical_product_name||row.product_name||row.title||'Scanned product',product_type:row.canonical_product_type||null,category_name:row.canonical_category_name||null,net_contents:row.canonical_net_contents||null,menu_count:0});
 }

 async function addToStore(event:FormEvent){
  event.preventDefault();if(!linkProduct||!storeId)return;
  setLinking(true);setError('');
  try{
   const response=await fetch('/api/admin/products-menus',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add-menu-item',dispensaryId:storeId,productId:linkProduct.id,itemName:linkProduct.product_name,brandName:linkProduct.brand_name,category:linkProduct.product_type,packageSize:packageSize.trim()||linkProduct.net_contents||null,price:price.trim()||null,inventoryStatus:'in_stock'})});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Could not add product to dispensary.');
   const storeName=selectedStore?.name||'dispensary';
   setNotice(body.alreadyLinked?`${label(linkProduct)} is already linked to ${storeName}.`:`Added ${label(linkProduct)} to ${storeName}.`);
   if(!body.alreadyLinked)setProducts(rows=>rows.map(row=>row.id===linkProduct.id?{...row,menu_count:Number(row.menu_count||0)+1}:row));
   setStats(current=>body.alreadyLinked?current:{...current,menuItems:current.menuItems+1});
   setLinkProduct(null);
  }catch(err){setError(err instanceof Error?err.message:'Could not add product to dispensary.');}
  finally{setLinking(false);}
 }

 async function findProduct(row:Scan){
  const term=String(row.canonical_product_name||row.product_name||row.title||'').trim();
  if(!term)return;
  setTab('products');setProductScope('reference');setSort('updated_desc');setQuery(term);await load('products',term,1,'updated_desc',pageSize,'reference');
 }

 async function reconcileMenuMatches(){
  setMatchBusy('reconcile');setError('');setNotice('');
  try{
   const response=await fetch('/api/admin/products-menus',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reconcile-menu-matches',limit:250})});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Could not reconcile menu matches.');
   setNotice(`Checked ${Number(body.processed||0).toLocaleString()} menu items: ${Number(body.autoLinked||0).toLocaleString()} auto-linked, ${Number(body.needsReview||0).toLocaleString()} need review, ${Number(body.unmatched||0).toLocaleString()} unmatched.`);
   await fetchView('matches',query);
  }catch(err){setError(err instanceof Error?err.message:'Could not reconcile menu matches.');}
  finally{setMatchBusy(null);}
 }

 async function reviewMenuMatch(row:MenuMatch,decision:'confirm'|'reject'){
  setMatchBusy(row.item_id);setError('');setNotice('');
  try{
   const response=await fetch('/api/admin/products-menus',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'review-menu-match',itemId:row.item_id,decision})});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Could not review menu match.');
   setNotice(decision==='confirm' ? `Linked ${row.item_name} at ${row.dispensary_name} to ${row.product_name}.` : `Rejected the suggested product match for ${row.item_name} at ${row.dispensary_name}.`);
   await fetchView('matches',query);
  }catch(err){setError(err instanceof Error?err.message:'Could not review menu match.');}
  finally{setMatchBusy(null);}
 }

 return <main className={styles.shell}>
  <header className={styles.header}><div><span>GEOWEEDO FACTS · PRODUCT LIBRARY</span><h1>Products & dispensaries</h1><p>Scanned products are the primary working list. Imported COA and state datasets stay available as the background reference library for matching, enrichment, and menu linking.</p></div><a href="/admin">← Admin</a></header>

  <section className={styles.stats}>
   <article><strong>{stats.scannedProducts.toLocaleString()}</strong><span>Scanned products</span></article>
   <article><strong>{stats.products.toLocaleString()}</strong><span>Reference library</span></article>
   <article><strong>{stats.verifiedProducts.toLocaleString()}</strong><span>Lab verified</span></article>
   <article><strong>{stats.menuItems.toLocaleString()}</strong><span>Menu links</span></article>
  </section>

  {error?<div className={styles.error}>{error}</div>:null}
  {notice?<div className={styles.notice}>{notice}</div>:null}

  <section className={styles.workspace}>
   <div className={styles.toolbar}>
    <nav>{(['products','matches','scans','exceptions'] as Tab[]).map(id=><button key={id} className={tab===id?styles.active:''} onClick={()=>changeTab(id)}>{id==='products'?'Products':id==='matches'?'Menu matches':id==='scans'?'Scans':'Needs attention'}</button>)}</nav>
    <form onSubmit={search}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={tab==='products'?'Search brand or product…':tab==='matches'?'Search dispensary or suggested product…':'Search scan, product, UID or COA…'}/><button disabled={loading}>{loading?'Loading…':'Search'}</button>{query?<button type="button" onClick={clearSearch}>Clear</button>:null}</form>
   </div>

   {linkProduct?<section className={styles.linkBox}>
    <div className={styles.linkHead}><div><span>ADD TO DISPENSARY</span><h2>{label(linkProduct)}</h2><p>{[linkProduct.category_name||linkProduct.product_type,linkProduct.net_contents].filter(Boolean).join(' · ')||'Known product'}</p></div><button onClick={()=>setLinkProduct(null)}>Close</button></div>
    <form className={styles.linkForm} onSubmit={addToStore}>
     <label>Find dispensary<div className={styles.storeSearch}><input value={storeQuery} onChange={e=>setStoreQuery(e.target.value)} placeholder="Name, city or state…"/><button type="button" onClick={()=>findStores()} disabled={storeLoading}>{storeLoading?'Searching…':'Search stores'}</button></div></label>
     <label>Dispensary<select required value={storeId} onChange={e=>setStoreId(e.target.value)}><option value="">Choose dispensary…</option>{stores.map(store=><option key={store.id} value={store.id}>{store.name}{store.city?` · ${store.city}`:''}{store.region?`, ${store.region}`:''}</option>)}</select><small>{stores.length.toLocaleString()} result{stores.length===1?'':'s'}</small></label>
     <label>Package size <small>optional</small><input value={packageSize} onChange={e=>setPackageSize(e.target.value)} placeholder="3.5 g, 1 pack…"/></label>
     <label>Price <small>optional</small><input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} placeholder="0.00"/></label>
     <button className={styles.primary} disabled={linking||!storeId}>{linking?'Adding…':'Add product to menu'}</button>
    </form>
   </section>:null}

   {tab==='products'?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>{productScope==='scanned'?'SCANNED PRODUCTS':'REFERENCE LIBRARY'}</span><h2>{query?`Results for “${query}”`:productScope==='scanned'?'Scanned products':'Background product library'}</h2><p>{query?`${catalog.total.toLocaleString()} matches.`:productScope==='scanned'?`${catalog.total.toLocaleString()} products GeoWeedo has actually seen through scans.`:`${catalog.total.toLocaleString()} COA, state-imported, and other reference products available for matching.`}</p></div><b>{products.length} shown</b></div>
    <div className={styles.productScope}><button type="button" className={productScope==='scanned'?styles.active:''} disabled={loading} onClick={()=>changeProductScope('scanned')}>Scanned products</button><button type="button" className={productScope==='reference'?styles.active:''} disabled={loading} onClick={()=>changeProductScope('reference')}>Reference library</button><small>{productScope==='scanned'?'Primary working list':'Background data for resolving scans, COAs, state imports, and menu matches'}</small></div>
    <div className={styles.catalogBar}><div><strong>{catalog.total?((catalog.page-1)*catalog.pageSize+1).toLocaleString():0}–{Math.min(catalog.total,catalog.page*catalog.pageSize).toLocaleString()}</strong><span> of {catalog.total.toLocaleString()}</span></div><div className={styles.catalogControls}><label>Sort<select value={sort} disabled={loading} onChange={e=>changeSort(e.target.value)}>{sortOptions.filter(([value])=>productScope==='scanned'||value!=='scanned_desc').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Per page<select value={pageSize} disabled={loading} onChange={e=>changePageSize(Number(e.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div></div>
    {products.length?<div className={styles.tableWrap}><table><thead><tr><th>Product</th><th>Facts</th><th>Availability</th><th></th></tr></thead><tbody>{products.map(product=>{const proof=verifiedById.get(product.id);return <tr key={product.id}><td><a href={`/product/${encodeURIComponent(product.id)}`} target="_blank">{label(product)}</a><small>{[product.category_name||product.product_type,product.net_contents].filter(Boolean).join(' · ')||'—'}</small></td><td>{productScope==='scanned'?<><b className={styles.good}>✓ Scanned by GeoWeedo</b><small>{Number(product.scan_count||0).toLocaleString()} scan{Number(product.scan_count||0)===1?'':'s'}{product.latest_scan_at?` · last ${new Date(product.latest_scan_at).toLocaleDateString()}`:''}</small>{proof?<small>{proof.verified_batch_count} verified lab batch{proof.verified_batch_count===1?'':'es'} · {product.batch_count} total</small>:<small>{product.batch_count} background batch{product.batch_count===1?'':'es'} available</small>}</>:proof?<><b className={styles.good}>✓ Lab verified reference</b><small>{proof.verified_batch_count} verified · {product.batch_count} total batches</small></>:<><b>Reference product</b><small>{product.batch_count} batch{product.batch_count===1?'':'es'} on file</small></>}</td><td>{product.menu_count>0?<><b className={styles.good}>{product.menu_count} menu link{product.menu_count===1?'':'s'}</b><small><a href={`/?product=${encodeURIComponent(product.id)}`} target="_blank">View availability</a></small></>:<><b>Not linked yet</b><small>Add when you find it on a menu.</small></>}</td><td><div className={styles.actions}><button className={styles.primary} onClick={()=>openLink(product)}>Add to dispensary</button><a href={`/product/${encodeURIComponent(product.id)}`} target="_blank">View facts</a></div></td></tr>;})}</tbody></table></div>:<div className={styles.empty}>{loading?'Loading products…':productScope==='scanned'?'No scanned products found yet. Use the Reference library only when you need background matching data.':'No reference products found.'}</div>}
    <div className={styles.pagination}><span>Page {catalog.page.toLocaleString()} of {catalog.pageCount.toLocaleString()}</span><div><button type="button" disabled={loading||catalog.page<=1} onClick={()=>goPage(1)}>First</button><button type="button" disabled={loading||catalog.page<=1} onClick={()=>goPage(catalog.page-1)}>Previous</button><button type="button" disabled={loading||catalog.page>=catalog.pageCount} onClick={()=>goPage(catalog.page+1)}>Next</button><button type="button" disabled={loading||catalog.page>=catalog.pageCount} onClick={()=>goPage(catalog.pageCount)}>Last</button></div></div>
   </section>:null}

   {tab==='matches'?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>MENU RECONCILIATION</span><h2>Product matches</h2><p>Exact and high-confidence matches link automatically. Possible matches stay private until you confirm them here.</p></div><button className={styles.primary} disabled={matchBusy!==null} onClick={()=>reconcileMenuMatches()}>{matchBusy==='reconcile'?'Checking…':'Check menu for matches'}</button></div>
    <div className={styles.matchSummary}>
     <article><strong>{menuMatchStats.linked.toLocaleString()}</strong><span>Linked</span></article>
     <article><strong>{menuMatchStats.needsReview.toLocaleString()}</strong><span>Needs review</span></article>
     <article><strong>{menuMatchStats.unmatched.toLocaleString()}</strong><span>Unmatched</span></article>
    </div>
    {menuMatches.length?<div className={styles.matchList}>{menuMatches.map(row=><article key={row.item_id} className={styles.matchCard}>
     <div className={styles.matchStore}><span>DISPENSARY MENU</span><strong>{row.dispensary_name}</strong><small>{[row.dispensary_city,row.dispensary_region].filter(Boolean).join(', ')||'—'}</small><b>{row.menu_brand_name?`${row.menu_brand_name} · `:''}{row.item_name}</b><small>{[row.category,row.package_size].filter(Boolean).join(' · ')||'Menu item'}</small></div>
     <div className={styles.matchArrow}>→</div>
     <div className={styles.matchProduct}><span>GEOWEEDO MATCH</span><strong>{row.product_brand_name?`${row.product_brand_name} · `:''}{row.product_name}</strong><small>{[row.product_type,row.net_contents].filter(Boolean).join(' · ')||'Canonical product'}</small><div className={styles.matchScore}>Match score <b>{Math.round(Number(row.match_score||0))}</b></div><small>{row.match_reason||'No match explanation available.'}</small></div>
     <div className={styles.matchActions}><button className={styles.primary} disabled={matchBusy!==null} onClick={()=>reviewMenuMatch(row,'confirm')}>{matchBusy===row.item_id?'Saving…':'Confirm match'}</button><button disabled={matchBusy!==null} onClick={()=>reviewMenuMatch(row,'reject')}>Not the same product</button>{row.source_url?<a href={row.source_url} target="_blank" rel="noreferrer">View source</a>:null}</div>
    </article>)}</div>:<div className={styles.empty}>{loading?'Loading menu matches…':'No possible menu matches need review.'}</div>}
   </section>:null}

   {tab==='scans'?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>SCANS</span><h2>Recent scans</h2><p>Only this tab loads scan data.</p></div><b>{scans.length} shown</b></div>
    {scans.length?<div className={styles.tableWrap}><table><thead><tr><th>Scan</th><th>Matched product</th><th>Facts</th><th></th></tr></thead><tbody>{scans.map(row=><tr key={row.id}><td><span>{compact(row.qr_value)}</span><small>{row.qr_host||new Date(row.last_seen_at).toLocaleString()}</small></td><td>{row.product_id?<a href={`/product/${encodeURIComponent(row.product_id)}`} target="_blank">{`${row.canonical_brand_name?`${row.canonical_brand_name} · `:''}${row.canonical_product_name||row.product_name||row.title||'Product'}`}</a>:<b>Not matched yet</b>}<small>{row.uid||row.batch_number||row.coa_number||'—'}</small></td><td>{row.verified_lab_batch?<b className={styles.good}>✓ Verified lab batch</b>:row.product_id?<b>Known product</b>:<b className={styles.warn}>Needs product match</b>}<small>{row.overall_status||row.canonical_lab_name||row.lab_name||'—'}</small></td><td>{row.product_id?<button className={styles.primary} onClick={()=>openLinkFromScan(row)}>Add to dispensary</button>:<button onClick={()=>findProduct(row)}>Find product</button>}</td></tr>)}</tbody></table></div>:<div className={styles.empty}>{loading?'Loading scans…':'No scans found.'}</div>}
   </section>:null}

   {tab==='exceptions'?<section className={styles.section}>
    <div className={styles.sectionHead}><div><span>ACTIONABLE ONLY</span><h2>Unmatched scans</h2><p>No owner-review queues or broad cleanup lists—only scans that still need a product match.</p></div><b>{stats.unlinkedQrs.toLocaleString()} total</b></div>
    {scans.length?<div className={styles.cards}>{scans.map(row=><article key={row.id}><div><strong>{row.product_name||row.title||'Unmatched scan'}</strong><small>{compact(row.qr_value,80)}</small></div><button onClick={()=>findProduct(row)}>Find product</button></article>)}</div>:<div className={styles.empty}>{loading?'Loading…':'No unmatched scans.'}</div>}
   </section>:null}
  </section>

  <details className={styles.advanced}><summary>Advanced cleanup tools</summary><div><a href="/admin/product-maintenance">Product maintenance</a><a href="/admin/data">Data imports</a></div></details>
 </main>;
}
