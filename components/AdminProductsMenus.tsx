'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import styles from './AdminProductsMenus.module.css';

type Product={id:string;brand_name:string|null;product_name:string;product_type:string|null;net_contents:string|null;barcode:string|null;batch_count:number;menu_count:number};
type Dispensary={id:string;name:string;city:string;region:string;country:string};
type MenuItem={id:string;item_name:string;brand_name:string|null;category:string|null;variant:string|null;package_size:string|null;price_cents:number|null;currency:string;inventory_status:string;verified:number;product_id:string|null;linked_product_name:string|null;source_url:string|null};
type Stats={products:number;menuItems:number;storesWithMenus:number};

const emptyStats:Stats={products:0,menuItems:0,storesWithMenus:0};
function money(cents:number|null|undefined){return Number.isFinite(Number(cents))?`$${(Number(cents)/100).toFixed(2)}`:'—';}

export default function AdminProductsMenus(){
 const[stats,setStats]=useState<Stats>(emptyStats),[products,setProducts]=useState<Product[]>([]),[dispensaries,setDispensaries]=useState<Dispensary[]>([]),[menuItems,setMenuItems]=useState<MenuItem[]>([]);
 const[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[productSearch,setProductSearch]=useState(''),[selectedProductId,setSelectedProductId]=useState(''),[selectedDispensaryId,setSelectedDispensaryId]=useState('');
 const[newProduct,setNewProduct]=useState({brandName:'',productName:'',productType:'',netContents:'',barcode:''});
 const[menuForm,setMenuForm]=useState({itemName:'',brandName:'',category:'',variant:'',packageSize:'',price:'',inventoryStatus:'in_stock',sourceUrl:'',verified:false});

 async function load(options?:{q?:string;dispensaryId?:string}){
  const params=new URLSearchParams();if(options?.q)params.set('q',options.q);if(options?.dispensaryId)params.set('dispensaryId',options.dispensaryId);
  const response=await fetch(`/api/admin/products-menus${params.size?`?${params}`:''}`,{cache:'no-store'});
  if(response.status===401){window.location.href='/admin/login';return null;}
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Could not load products and menus.');
  setStats(data.stats||emptyStats);setProducts(Array.isArray(data.products)?data.products:[]);setDispensaries(Array.isArray(data.dispensaries)?data.dispensaries:[]);setMenuItems(Array.isArray(data.menuItems)?data.menuItems:[]);return data;
 }
 useEffect(()=>{load().catch(err=>setError(err.message)).finally(()=>setLoading(false));},[]);
 useEffect(()=>{if(!selectedDispensaryId){setMenuItems([]);return;}load({q:productSearch,dispensaryId:selectedDispensaryId}).catch(err=>setError(err.message));},[selectedDispensaryId]);

 const selectedProduct=useMemo(()=>products.find(p=>p.id===selectedProductId)||null,[products,selectedProductId]);
 const selectedDispensary=useMemo(()=>dispensaries.find(d=>d.id===selectedDispensaryId)||null,[dispensaries,selectedDispensaryId]);

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
  <header className={styles.header}><div><span>WEEDO FACTS · RETAIL CATALOG</span><h1>Products & menus</h1><p>Create canonical products, then link them to dispensary menu listings so product search, product pages, and map availability have real data.</p></div><a href="/admin">← Admin</a></header>
  <section className={styles.stats}><article><strong>{stats.products.toLocaleString()}</strong><span>Products</span></article><article><strong>{stats.menuItems.toLocaleString()}</strong><span>Active menu items</span></article><article><strong>{stats.storesWithMenus.toLocaleString()}</strong><span>Stores with menus</span></article></section>
  {error?<div className={styles.error}>{error}</div>:null}{notice?<div className={styles.notice}>{notice}</div>:null}

  <div className={styles.columns}>
   <section className={styles.panel}><div className={styles.panelHead}><span>STEP 1</span><h2>Create product</h2><p>Use one canonical product record per brand/product combination. UPC/EAN is optional.</p></div>
    <form className={styles.form} onSubmit={createProduct}>
     <label>Brand<input value={newProduct.brandName} onChange={e=>setNewProduct(v=>({...v,brandName:e.target.value}))} placeholder="MFNY"/></label>
     <label>Product name<input required value={newProduct.productName} onChange={e=>setNewProduct(v=>({...v,productName:e.target.value}))} placeholder="Hash Burger"/></label>
     <div className={styles.row}><label>Product type<input value={newProduct.productType} onChange={e=>setNewProduct(v=>({...v,productType:e.target.value}))} placeholder="Flower, vape, edible…"/></label><label>Net contents<input value={newProduct.netContents} onChange={e=>setNewProduct(v=>({...v,netContents:e.target.value}))} placeholder="3.5 g"/></label></div>
     <label>UPC / EAN<input inputMode="numeric" value={newProduct.barcode} onChange={e=>setNewProduct(v=>({...v,barcode:e.target.value.replace(/\D/g,'')}))} placeholder="Optional 8–14 digit barcode"/></label>
     <button disabled={saving}>{saving?'Saving…':'Create product'}</button>
    </form>
   </section>

   <section className={styles.panel}><div className={styles.panelHead}><span>STEP 2</span><h2>Add to dispensary menu</h2><p>Select a real GeoWeedo product and store, then publish its retail availability.</p></div>
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
