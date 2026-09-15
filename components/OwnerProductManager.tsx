'use client';

import { useEffect, useMemo, useState } from 'react';

type Category={id:string;name:string;slug:string};
type MenuItem={
  id:string;product_id?:string|null;item_name:string;brand_name?:string|null;package_size?:string|null;variant?:string|null;
  price_cents?:number|null;inventory_status?:string|null;canonical_category_id?:string|null;canonical_category_name?:string|null;
  linked_product_name?:string|null;linked_brand_name?:string|null;
};
type ProductHit={id:string;productName:string;brandName?:string|null;productType?:string|null;categoryId?:string|null;categoryName?:string|null};
type FormState={itemName:string;brandName:string;categoryId:string;packageSize:string;variant:string;price:string;inventoryStatus:string;productId:string};

const EMPTY:FormState={itemName:'',brandName:'',categoryId:'',packageSize:'',variant:'',price:'',inventoryStatus:'in_stock',productId:''};

function money(cents?:number|null){return cents==null?'—':`$${(cents/100).toFixed(2)}`;}
function priceToCents(value:string){const n=Number(value);return Number.isFinite(n)&&n>=0?Math.round(n*100):null;}

export default function OwnerProductManager({locationId}:{locationId:string}){
  const[items,setItems]=useState<MenuItem[]>([]),[categories,setCategories]=useState<Category[]>([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const[message,setMessage]=useState<string|null>(null),[editingId,setEditingId]=useState<string|null>(null),[form,setForm]=useState<FormState>(EMPTY);
  const[search,setSearch]=useState(''),[hits,setHits]=useState<ProductHit[]>([]),[searching,setSearching]=useState(false);
  const linked=useMemo(()=>hits.find(hit=>hit.id===form.productId)||null,[hits,form.productId]);

  async function load(){
    if(!locationId)return;setLoading(true);setMessage(null);
    try{const r=await fetch(`/api/owner/products?locationId=${encodeURIComponent(locationId)}`,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load products.');setItems(d.items||[]);setCategories(d.categories||[]);}catch(e){setMessage(e instanceof Error?e.message:'Could not load products.');}finally{setLoading(false);}
  }
  useEffect(()=>{setEditingId(null);setForm(EMPTY);setHits([]);setSearch('');void load();},[locationId]);

  async function findProducts(){
    if(search.trim().length<2){setHits([]);return;}setSearching(true);setMessage(null);
    try{const r=await fetch(`/api/owner/products?locationId=${encodeURIComponent(locationId)}&q=${encodeURIComponent(search.trim())}`,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not search products.');setHits(d.products||[]);}catch(e){setMessage(e instanceof Error?e.message:'Could not search products.');}finally{setSearching(false);}
  }

  function chooseProduct(hit:ProductHit){
    setHits(current=>current.some(item=>item.id===hit.id)?current:[hit,...current]);
    setForm(v=>({...v,productId:hit.id,itemName:hit.productName||v.itemName,brandName:hit.brandName||v.brandName,categoryId:hit.categoryId||v.categoryId}));
    setSearch(`${hit.brandName?`${hit.brandName} · `:''}${hit.productName}`);
  }

  function edit(item:MenuItem){
    setEditingId(item.id);setHits([]);setSearch(item.linked_product_name?`${item.linked_brand_name?`${item.linked_brand_name} · `:''}${item.linked_product_name}`:'');
    setForm({
      itemName:item.item_name||'',brandName:item.brand_name||'',categoryId:item.canonical_category_id||'',packageSize:item.package_size||'',variant:item.variant||'',
      price:item.price_cents==null?'':(item.price_cents/100).toFixed(2),inventoryStatus:item.inventory_status||'in_stock',productId:item.product_id||'',
    });
  }

  function reset(){setEditingId(null);setForm(EMPTY);setSearch('');setHits([]);}

  async function save(){
    if(!form.itemName.trim()){setMessage('Product name is required.');return;}setSaving(true);setMessage(null);
    try{const payload={locationId,itemId:editingId||undefined,itemName:form.itemName.trim(),brandName:form.brandName.trim(),categoryId:form.categoryId||null,packageSize:form.packageSize.trim(),variant:form.variant.trim(),priceCents:priceToCents(form.price),inventoryStatus:form.inventoryStatus,productId:form.productId||null};
      const r=await fetch('/api/owner/products',{method:editingId?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not save product.');setMessage(editingId?'Product listing updated.':'Product added to your menu.');reset();await load();
    }catch(e){setMessage(e instanceof Error?e.message:'Could not save product.');}finally{setSaving(false);}
  }

  async function remove(item:MenuItem){
    if(!window.confirm(`Remove “${item.item_name}” from this dispensary menu?`))return;setMessage(null);
    try{const r=await fetch(`/api/owner/products?locationId=${encodeURIComponent(locationId)}&itemId=${encodeURIComponent(item.id)}`,{method:'DELETE'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not remove product.');if(editingId===item.id)reset();setMessage('Product removed from the public menu.');await load();}catch(e){setMessage(e instanceof Error?e.message:'Could not remove product.');}
  }

  return <section className="owner-panel" id="products">
    <div className="owner-panel-head"><div><span>PRODUCTS & MENU</span><h2>Manage products</h2></div><a href={`/dispensary/${encodeURIComponent(locationId)}#menu`} target="_blank" rel="noreferrer">View public menu ↗</a></div>
    <p style={{marginTop:0}}>Add products sold at this dispensary, link them to GeoWeedo Products when possible, and keep retail price, package and availability current.</p>
    {message&&<div className="owner-message" style={{margin:'12px 0'}}>{message}</div>}

    <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(320px,.9fr)',gap:18,alignItems:'start'}}>
      <div style={{display:'grid',gap:10}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'baseline'}}><strong>Current menu ({items.length})</strong><button type="button" className="owner-primary" style={{width:'auto',padding:'8px 12px'}} onClick={reset}>+ Add product</button></div>
        {loading?<small>Loading products…</small>:items.length===0?<div style={{border:'1px dashed var(--border)',borderRadius:12,padding:16,color:'var(--muted)'}}>No products yet. Add the first product for this shop.</div>:items.map(item=><div key={item.id} style={{border:'1px solid var(--border)',borderRadius:12,padding:12,display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'start',background:editingId===item.id?'rgba(103,214,110,.06)':'rgba(255,255,255,.015)'}}>
          <div><strong style={{display:'block'}}>{item.item_name}</strong><small>{[item.brand_name,item.canonical_category_name,item.package_size,item.variant].filter(Boolean).join(' · ')||'Owner-reported product'}</small><div style={{marginTop:6,fontSize:13}}><strong>{money(item.price_cents)}</strong> · {(item.inventory_status||'unknown').replaceAll('_',' ')} {item.product_id&&<span style={{marginLeft:8,color:'#67d66e'}}>GeoWeedo Product linked</span>}</div></div>
          <div style={{display:'flex',gap:7}}><button type="button" onClick={()=>edit(item)}>Edit</button><button type="button" onClick={()=>void remove(item)}>Remove</button></div>
        </div>)}
      </div>

      <div style={{border:'1px solid var(--border)',borderRadius:14,padding:14,background:'rgba(255,255,255,.015)'}}>
        <strong style={{display:'block',fontSize:'1.08rem',marginBottom:4}}>{editingId?'Edit product listing':'Add product'}</strong>
        <small style={{display:'block',marginBottom:12}}>Search GeoWeedo first. If there is no match, leave it unlinked and create an owner-reported listing.</small>
        <label style={{display:'block'}}>Find existing GeoWeedo Product<div style={{display:'flex',gap:7}}><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void findProducts();}}} placeholder="Product or brand"/><button type="button" onClick={()=>void findProducts()} disabled={searching}>{searching?'Searching…':'Search'}</button></div></label>
        {hits.length>0&&<div style={{display:'grid',gap:6,maxHeight:190,overflow:'auto',margin:'8px 0 12px'}}>{hits.map(hit=><button key={hit.id} type="button" onClick={()=>chooseProduct(hit)} style={{textAlign:'left',padding:9,borderRadius:10,border:'1px solid var(--border)',background:form.productId===hit.id?'rgba(103,214,110,.1)':'transparent',color:'inherit'}}><strong>{hit.productName}</strong><br/><small>{[hit.brandName,hit.categoryName].filter(Boolean).join(' · ')}</small></button>)}</div>}
        {form.productId&&<div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',margin:'8px 0 12px',padding:'8px 10px',borderRadius:10,background:'rgba(103,214,110,.08)'}}><small><strong>Linked:</strong> {linked?.productName||form.itemName}</small><button type="button" onClick={()=>setForm(v=>({...v,productId:''}))}>Unlink</button></div>}

        <div style={{display:'grid',gap:10}}>
          <label>Product / listing name<input value={form.itemName} onChange={e=>setForm(v=>({...v,itemName:e.target.value}))} maxLength={240}/></label>
          <label>Brand<input value={form.brandName} onChange={e=>setForm(v=>({...v,brandName:e.target.value}))} maxLength={180}/></label>
          <label>Category<select value={form.categoryId} onChange={e=>setForm(v=>({...v,categoryId:e.target.value}))}><option value="">Other / uncategorized</option>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><label>Package size<input value={form.packageSize} onChange={e=>setForm(v=>({...v,packageSize:e.target.value}))} placeholder="3.5 g"/></label><label>Variant<input value={form.variant} onChange={e=>setForm(v=>({...v,variant:e.target.value}))} placeholder="Flavor / format"/></label></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><label>Price (USD)<input inputMode="decimal" value={form.price} onChange={e=>setForm(v=>({...v,price:e.target.value}))} placeholder="29.99"/></label><label>Availability<select value={form.inventoryStatus} onChange={e=>setForm(v=>({...v,inventoryStatus:e.target.value}))}><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="out_of_stock">Out of stock</option><option value="unknown">Unknown</option></select></label></div>
          <div style={{display:'flex',gap:8}}><button className="owner-primary" type="button" disabled={saving} onClick={()=>void save()}>{saving?'Saving…':editingId?'Save changes':'Add to menu'}</button>{editingId&&<button type="button" onClick={reset}>Cancel</button>}</div>
        </div>
      </div>
    </div>
  </section>;
}
