'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import styles from './AdminProductsMenus.module.css';

type Product={id:string;brand_name:string|null;product_name:string;product_type:string|null;net_contents:string|null;barcode:string|null;batch_count:number;menu_count:number};
type VerifiedProduct={id:string;brand_name:string|null;product_name:string;product_type:string|null;net_contents:string|null;verified_batch_count:number;qr_count:number;qr_scan_events:number;latest_uid:string|null;latest_coa_number:string|null;latest_lab_name:string|null;latest_status:string|null;latest_tested_at:string|null;updated_at:string};
type QrScan={id:string;qr_value:string;qr_host:string|null;resolver:string;product_id:string|null;batch_id:string|null;external_identifier:string|null;title:string|null;brand_name:string|null;product_name:string|null;product_type:string|null;producer_name:string|null;lab_name:string|null;tested_at:string|null;coa_url:string|null;first_seen_at:string;last_seen_at:string;scan_count:number;canonical_brand_name:string|null;canonical_product_name:string|null;canonical_product_type:string|null;canonical_net_contents:string|null;batch_number:string|null;uid:string|null;coa_number:string|null;overall_status:string|null;canonical_lab_name:string|null;batch_verified:number;batch_source_type:string|null;verified_lab_batch:number};
type Dispensary={id:string;name:string;city:string;region:string;country:string};
type MenuItem={id:string;item_name:string;brand_name:string|null;category:string|null;variant:string|null;package_size:string|null;price_cents:number|null;currency:string;inventory_status:string;verified:number;product_id:string|null;linked_product_name:string|null;source_url:string|null};
type Stats={products:number;verifiedProducts:number;verifiedBatches:number;qrCodes:number;qrScanEvents:number;unlinkedQrs:number;menuItems:number;storesWithMenus:number};

const emptyStats:Stats={products:0,verifiedProducts:0,verifiedBatches:0,qrCodes:0,qrScanEvents:0,unlinkedQrs:0,menuItems:0,storesWithMenus:0};
function money(cents:number|null|undefined){return Number.isFinite(Number(cents))?`$${(Number(cents)/100).toFixed(2)}`:'—';}
function dateTime(value:string|null|undefined){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString();}
function compact(value:string|null|undefined,max=58){const text=String(value||'').trim();return text.length>max?`${text.slice(0,max-1)}…`:text||'—';}
function isHttp(value:string){return /^https?:\/\//i.test(value);}

export default function AdminProductsMenus(){
 const[stats,setStats]=useState<Stats>(emptyStats),[products,setProducts]=useState<Product[]>([]),[verifiedProducts,setVerifiedProducts]=useState<VerifiedProduct[]>([]),[qrScans,setQrScans]=useState<QrScan[]>([]),[dispensaries,setDispensaries]=useState<Dispensary[]>([]),[menuItems,setMenuItems]=useState<MenuItem[]>([]);
 const[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[productSearch,setProductSearch]=useState(''),[auditSearch,setAuditSearch]=useState(''),[selectedProductId,setSelectedProductId]=useState(''),[selectedDispensaryId,setSelectedDispensaryId]=useState('');
 const[newProduct,setNewProduct]=useState({brandName:'',productName:'',productType:'',netContents:'',barcode:''});
 const[menuForm,setMenuForm]=useState({itemName:'',brandName:'',category:'',variant:'',packageSize:'',price:'',inventoryStatus:'in_stock',sourceUrl:'',verified:false});

 async function load(options?:{q?:string;dispensaryId?:string}){
  const params=new URLSearchParams();if(options?.q)params.set('q',options.q);if(options?.dispensaryId)params.set('dispensaryId',options.dispensaryId);
  const response=await fetch(`/api/admin/products-menus${params.size?`?${params}`:''}`,{cache:'no-store'});
  if(response.status===401){window.location.href='/admin/login';return null;}
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Could not load products and menus.');
  setStats({...emptyStats,...(data.stats||{})});setProducts(Array.isArray(data.products)?data.products:[]);setVerifiedProducts(Array.isArray(data.verifiedProducts)?data.verifiedProducts:[]);setQrScans(Array.isArray(data.qrScans)?data.qrScans:[]);setDispensaries(Array.isArray(data.dispensaries)?data.dispensaries:[]);setMenuItems(Array.isArray(data.menuItems)?data.menuItems:[]);return data;
 }
 useEffect(()=>{load().catch(err=>setError(err.message)).finally(()=>setLoading(false));},[]);
 useEffect(()=>{if(!selectedDispensaryId){setMenuItems([]);return;}load({q:productSearch,dispensaryId:selectedDispensaryId}).catch(err=>setError(err.message));},[selectedDispensaryId]);

 const selectedProduct=useMemo(()=>products.find(p=>p.id===selectedProductId)||null,[products,selectedProductId]);
 const selectedDispensary=useMemo(()=>dispensaries.find(d=>d.id===selectedDispensaryId)||null,[dispensaries,selectedDispensaryId]);
 const filteredVerifiedProducts=useMemo(()=>{const q=auditSearch.trim().toLowerCase();if(!q)return verifiedProducts;return verifiedProducts.filter(p=>[p.brand_name,p.product_name,p.product_type,p.net_contents,p.latest_uid,p.latest_coa_number,p.latest_lab_name,p.latest_status].some(v=>String(v||'').toLowerCase().includes(q)));},[verifiedProducts,auditSearch]);
 const filteredQrScans=useMemo(()=>{const q=auditSearch.trim().toLowerCase();if(!q)return qrScans;return qrScans.filter(row=>[row.qr_value,row.qr_host,row.resolver,row.external_identifier,row.canonical_brand_name,row.canonical_product_name,row.product_name,row.batch_number,row.uid,row.coa_number,row.canonical_lab_name,row.lab_name,row.overall_status].some(v=>String(v||'').toLowerCase().includes(q)));},[qrScans,auditSearch]);

 async function createProduct(event:FormEvent){
  event.preventDefault();setSaving(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/admin/products-menus',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create-product',...newProduct})});
   const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Could not create product.');
   setNotice(`Created ${newProduct.brandName?`${newProduct.brandName} · `:''}${newProduct.productName}.`);setProductSearch(newProduct.productName);setSelectedProductId(data.productId||'');
   await load({q:newProduct.productName,dispensaryId:selectedDispensaryId});
   setNewProduct({brandName:'',productName:'',productType:'',netContents:'',barcode:''});
  }catch(err){setError(err instanceof Error?err.message:'Could not create product.');}finally{setSaving(false);}
 }

 async function searchProducts(event?:FormEvent){event?.preventDefault();setError('');setLoading(true);try{await load({q:productSearch,dispensaryId:selectedDispensaryId});}catch(err){setError(err instanceof Error?err.message:'Search failed.');}finally{setLoading(false);}}

 async function addMenuItem(event:FormEvent){
  event.preventDefault();if(!selectedDispensaryId||!selectedProductId)return;setSaving(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/admin/products-menus',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add-menu-item',dispensaryId:selectedDispensaryId,productId:selectedProductId,...menuForm})});
   const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Could not add menu item.');
   setMenuItems(Array.isArray(data.menuItems)?data.menuItems:[]);setNotice(`Added ${menuForm.itemName} to ${selectedDispensary?.name||'the dispensary'} menu.`);
   setMenuForm({itemName:'',brandName:'',category:'',variant:'',packageSize:'',price:'',inventoryStatus:'in_stock',sourceUrl:'',verified:false});
   await load({q:productSearch,dispensaryId:selectedDispensaryId});
  }catch(err){setError(err instanceof Error?err.message:'Could not add menu item.');}finally{setSaving(false);}
 }

 if(loading&&!dispensaries.length)return <main className={styles.shell}><div className={styles.loading}>Loading products & menus…</div></main>;
 return <main className={styles.shell}>
  <header className={styles.header}><div><span>WEEDO FACTS · PRODUCT DATABASE</span><h1>Products & scans</h1><p>Audit uploaded QR codes, verified lab products, canonical product records, and dispensary menu availability from one admin screen.</p></div><a href="/admin">← Admin</a></header>
  <section className={styles.stats}>
   <article><strong>{stats.products.toLocaleString()}</strong><span>All products</span></article>
   <article><strong>{stats.verifiedProducts.toLocaleString()}</strong><span>Verified products</span></article>
   <article><strong>{stats.verifiedBatches.toLocaleString()}</strong><span>Verified batches</span></article>
   <article><strong>{stats.qrCodes.toLocaleString()}</strong><span>Uploaded QR codes</span></article>
   <article><strong>{stats.qrScanEvents.toLocaleString()}</strong><span>Total QR scans</span></article>
   <article><strong>{stats.unlinkedQrs.toLocaleString()}</strong><span>QRs needing linkage</span></article>
  </section>
  {error?<div className={styles.error}>{error}</div>:null}{notice?<div className={styles.notice}>{notice}</div>:null}

  <section className={styles.auditPanel}>
   <div className={styles.auditHead}><div className={styles.panelHead}><span>WEEDO FACTS AUDIT</span><h2>Uploaded QR codes & verified products</h2><p>Every persisted QR appears here. A product is listed as verified only when it has at least one verified lab batch.</p></div><input value={auditSearch} onChange={e=>setAuditSearch(e.target.value)} placeholder="Filter product, UID, COA, QR, lab…" aria-label="Filter QR codes and verified products"/></div>
   <div className={styles.auditGrid}>
    <section className={styles.auditCard}>
     <div className={styles.listHead}><div><strong>Verified products</strong><span>{filteredVerifiedProducts.length.toLocaleString()} shown · {verifiedProducts.length.toLocaleString()} total</span></div></div>
     {filteredVerifiedProducts.length===0?<div className={styles.empty}>No verified products match this filter.</div>:<div className={styles.tableWrap}><table className={styles.auditTable}><thead><tr><th>Product</th><th>Verified</th><th>Latest batch</th><th>Lab / status</th><th>Scans</th></tr></thead><tbody>{filteredVerifiedProducts.map(p=><tr key={p.id}><td><a className={styles.primaryLink} href={`/product/${encodeURIComponent(p.id)}`} target="_blank">{p.brand_name?`${p.brand_name} · `:''}{p.product_name}</a><small>{[p.product_type,p.net_contents].filter(Boolean).join(' · ')||'—'}</small></td><td><b className={styles.good}>✓ {Number(p.verified_batch_count||0)} batch{Number(p.verified_batch_count||0)===1?'':'es'}</b><small>{dateTime(p.latest_tested_at)}</small></td><td><code>{p.latest_uid||'—'}</code><small>COA {p.latest_coa_number||'—'}</small></td><td><span>{p.latest_lab_name||'—'}</span><small>{p.latest_status||'Verified lab evidence'}</small></td><td><span>{Number(p.qr_count||0).toLocaleString()} QR{Number(p.qr_count||0)===1?'':'s'}</span><small>{Number(p.qr_scan_events||0).toLocaleString()} scan events</small></td></tr>)}</tbody></table></div>}
    </section>

    <section className={styles.auditCard}>
     <div className={styles.listHead}><div><strong>Uploaded QR codes</strong><span>{filteredQrScans.length.toLocaleString()} shown · {qrScans.length.toLocaleString()} total</span></div></div>
     {filteredQrScans.length===0?<div className={styles.empty}>No uploaded QR codes match this filter.</div>:<div className={styles.tableWrap}><table className={styles.auditTable}><thead><tr><th>QR</th><th>Product</th><th>Batch / evidence</th><th>Status</th><th>Activity</th></tr></thead><tbody>{filteredQrScans.map(row=>{const productName=row.canonical_product_name||row.product_name||row.title||'Unlinked QR';const brand=row.canonical_brand_name||row.brand_name;return <tr key={row.id}><td>{isHttp(row.qr_value)?<a className={styles.qrLink} href={row.qr_value} target="_blank" rel="noreferrer" title={row.qr_value}>{compact(row.qr_value)}</a>:<code title={row.qr_value}>{compact(row.qr_value)}</code>}<small>{[row.qr_host,row.resolver].filter(Boolean).join(' · ')||'—'}</small></td><td>{row.product_id?<a className={styles.primaryLink} href={`/product/${encodeURIComponent(row.product_id)}`} target="_blank">{brand?`${brand} · `:''}{productName}</a>:<span>{brand?`${brand} · `:''}{productName}</span>}<small>{[row.canonical_product_type||row.product_type,row.canonical_net_contents].filter(Boolean).join(' · ')||'Not linked to canonical product'}</small></td><td><code>{row.uid||row.external_identifier||'—'}</code><small>{[row.batch_number?`Batch ${row.batch_number}`:null,row.coa_number?`COA ${row.coa_number}`:null].filter(Boolean).join(' · ')||'No verified batch yet'}</small></td><td>{row.verified_lab_batch?<b className={styles.good}>✓ COA verified</b>:row.product_id&&row.batch_id?<b className={styles.pending}>Source-backed</b>:<b className={styles.muted}>Unlinked</b>}<small>{row.overall_status||row.canonical_lab_name||row.lab_name||'—'}</small></td><td><span>{Number(row.scan_count||0).toLocaleString()} scan{Number(row.scan_count||0)===1?'':'s'}</span><small>Last {dateTime(row.last_seen_at)}</small></td></tr>;})}</tbody></table></div>}
    </section>
   </div>
  </section>

  <div className={styles.columns}>
   <section className={styles.panel}><div className={styles.panelHead}><span>CATALOG</span><h2>Create product</h2><p>Use one canonical product record per brand/product combination. UPC/EAN is optional.</p></div>
    <form className={styles.form} onSubmit={createProduct}>
     <label>Brand<input value={newProduct.brandName} onChange={e=>setNewProduct(v=>({...v,brandName:e.target.value}))} placeholder="MFNY"/></label>
     <label>Product name<input required value={newProduct.productName} onChange={e=>setNewProduct(v=>({...v,productName:e.target.value}))} placeholder="Hash Burger"/></label>
     <div className={styles.row}><label>Product type<input value={newProduct.productType} onChange={e=>setNewProduct(v=>({...v,productType:e.target.value}))} placeholder="Flower, vape, edible…"/></label><label>Net contents<input value={newProduct.netContents} onChange={e=>setNewProduct(v=>({...v,netContents:e.target.value}))} placeholder="3.5 g"/></label></div>
     <label>UPC / EAN<input inputMode="numeric" value={newProduct.barcode} onChange={e=>setNewProduct(v=>({...v,barcode:e.target.value.replace(/\D/g,'')}))} placeholder="Optional 8–14 digit barcode"/></label>
     <button disabled={saving}>{saving?'Saving…':'Create product'}</button>
    </form>
   </section>

   <section className={styles.panel}><div className={styles.panelHead}><span>RETAIL AVAILABILITY</span><h2>Add to dispensary menu</h2><p>Select a real GeoWeedo product and store, then publish its retail availability.</p></div>
    <form className={styles.search} onSubmit={searchProducts}><input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="Search existing products"/><button>Search</button></form>
    <label className={styles.selectLabel}>Product<select value={selectedProductId} onChange={e=>{const id=e.target.value;setSelectedProductId(id);const p=products.find(x=>x.id===id);if(p)setMenuForm(v=>({...v,itemName:p.product_name,brandName:p.brand_name||v.brandName,packageSize:p.net_contents||v.packageSize,category:p.product_type||v.category}));}}><option value="">Choose product…</option>{products.map(p=><option key={p.id} value={p.id}>{p.brand_name?`${p.brand_name} · `:''}{p.product_name}{p.net_contents?` · ${p.net_contents}`:''}</option>)}</select></label>
    {selectedProduct?<div className={styles.selection}><strong>{selectedProduct.brand_name?`${selectedProduct.brand_name} · `:''}{selectedProduct.product_name}</strong><span>{[selectedProduct.product_type,selectedProduct.net_contents,selectedProduct.barcode?`UPC/EAN ${selectedProduct.barcode}`:null,`${selectedProduct.menu_count} menu listings`].filter(Boolean).join(' · ')}</span><a href={`/product/${encodeURIComponent(selectedProduct.id)}`} target="_blank">Open product page ↗</a></div>:null}
    <label className={styles.selectLabel}>Dispensary<select value={selectedDispensaryId} onChange={e=>setSelectedDispensaryId(e.target.value)}><option value="">Choose dispensary…</option>{dispensaries.map(d=><option key={d.id} value={d.id}>{d.region} · {d.city} · {d.name}</option>)}</select></label>
    <form className={styles.form} onSubmit={addMenuItem}>
     <label>Menu item name<input required value={menuForm.itemName} onChange={e=>setMenuForm(v=>({...v,itemName:e.target.value}))} placeholder="Retail menu title"/></label>
     <div className={styles.row}><label>Brand<input value={menuForm.brandName} onChange={e=>setMenuForm(v=>({...v,brandName:e.target.value}))}/></label><label>Category<input value={menuForm.category} onChange={e=>setMenuForm(v=>({...v,category:e.target.value}))} placeholder="Flower"/></label></div>
     <div className={styles.row}><label>Variant<input value={menuForm.variant} onChange={e=>setMenuForm(v=>({...v,variant:e.target.value}))} placeholder="Indica, 510 cart…"/></label><label>Package size<input value={menuForm.packageSize} onChange={e=>setMenuForm(v=>({...v,packageSize:e.target.value}))} placeholder="3.5 g"/></label></div>
     <div className={styles.row}><label>Price USD<input inputMode="decimal" value={menuForm.price} onChange={e=>setMenuForm(v=>({...v,price:e.target.value}))} placeholder="35.00"/></label><label>Inventory<select value={menuForm.inventoryStatus} onChange={e=>setMenuForm(v=>({...v,inventoryStatus:e.target.value}))}><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="unknown">Unknown</option><option value="out_of_stock">Out of stock</option></select></label></div>
     <label>Menu/source URL<input type="url" value={menuForm.sourceUrl} onChange={e=>setMenuForm(v=>({...v,sourceUrl:e.target.value}))} placeholder="https://dispensary.example/menu/..."/></label>
     <label className={styles.check}><input type="checkbox" checked={menuForm.verified} onChange={e=>setMenuForm(v=>({...v,verified:e.target.checked}))}/><span>Mark this retail listing verified. Use only after checking the source.</span></label>
     <button disabled={saving||!selectedProductId||!selectedDispensaryId}>{saving?'Saving…':'Add menu item'}</button>
    </form>
   </section>
  </div>

  <section className={styles.menuPanel}><div className={styles.panelHead}><span>STORE MENU</span><h2>{selectedDispensary?.name||'Choose a dispensary'}</h2><p>{selectedDispensary?'Active GeoWeedo menu listings for this store.':'Select a dispensary above to inspect its current menu.'}</p></div>
   {selectedDispensary&&menuItems.length===0?<div className={styles.empty}>No menu items yet.</div>:null}
   <div className={styles.menuList}>{menuItems.map(item=><article key={item.id}><div><strong>{item.brand_name?`${item.brand_name} · `:''}{item.item_name}</strong><span>{[item.category,item.variant,item.package_size,item.inventory_status].filter(Boolean).join(' · ')}</span></div><div><b>{money(item.price_cents)}</b><small>{item.verified?'✓ Verified':'Reported'}</small>{item.product_id?<a href={`/product/${encodeURIComponent(item.product_id)}`} target="_blank">Product ↗</a>:null}</div></article>)}</div>
  </section>
 </main>;
}
