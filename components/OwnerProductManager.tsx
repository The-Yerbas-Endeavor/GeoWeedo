'use client';

import { useEffect, useMemo, useState } from 'react';
import OwnerProductBarcodeScanner from '@/components/OwnerProductBarcodeScanner';

type Category={id:string;name:string;slug:string};
type MenuItem={
  id:string;product_id?:string|null;item_name:string;brand_name?:string|null;package_size?:string|null;variant?:string|null;
  price_cents?:number|null;inventory_status?:string|null;canonical_category_id?:string|null;canonical_category_name?:string|null;
  linked_product_name?:string|null;linked_brand_name?:string|null;owner_scan_type?:string|null;owner_scan_value?:string|null;
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
  const[scanValue,setScanValue]=useState(''),[scanType,setScanType]=useState('');
  const linked=useMemo(()=>hits.find(hit=>hit.id===form.productId)||null,[hits,form.productId]);

  async function load(){
    if(!locationId)return;setLoading(true);setMessage(null);
    try{const r=await fetch(`/api/owner/products?locationId=${encodeURIComponent(locationId)}`,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load products.');setItems(d.items||[]);setCategories(d.categories||[]);}catch(e){setMessage(e instanceof Error?e.message:'Could not load products.');}finally{setLoading(false);}
  }
  useEffect(()=>{setEditingId(null);setForm(EMPTY);setHits([]);setSearch('');setScanValue('');setScanType('');void load();},[locationId]);

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
    setEditingId(item.id);setHits([]);setScanValue(item.owner_scan_value||'');setScanType(item.owner_scan_type||'');setSearch(item.linked_product_name?`${item.linked_brand_name?`${item.linked_brand_name} · `:''}${item.linked_product_name}`:'');
    setForm({
      itemName:item.item_name||'',brandName:item.brand_name||'',categoryId:item.canonical_category_id||'',packageSize:item.package_size||'',variant:item.variant||'',
      price:item.price_cents==null?'':(item.price_cents/100).toFixed(2),inventoryStatus:item.inventory_status||'in_stock',productId:item.product_id||'',
    });
  }

  function reset(){setEditingId(null);setForm(EMPTY);setSearch('');setHits([]);setScanValue('');setScanType('');}

  async function save(){
    if(!form.itemName.trim()){setMessage('Product name is required.');return;}setSaving(true);setMessage(null);
    try{const payload={locationId,itemId:editingId||undefined,itemName:form.itemName.trim(),brandName:form.brandName.trim(),categoryId:form.categoryId||null,packageSize:form.packageSize.trim(),variant:form.variant.trim(),priceCents:priceToCents(form.price),inventoryStatus:form.inventoryStatus,productId:form.productId||null,scanValue:scanValue||null,identifierType:scanType||null};
      const r=await fetch('/api/owner/products',{method:editingId?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not save product.');setMessage(editingId?'Product listing updated.':'Product added to your menu.');reset();await load();
    }catch(e){setMessage(e instanceof Error?e.message:'Could not save product.');}finally{setSaving(false);}
  }

  async function remove(item:MenuItem){
    if(!window.confirm(`Remove “${item.item_name}” from this dispensary menu?`))return;setMessage(null);
    try{const r=await fetch(`/api/owner/products?locationId=${encodeURIComponent(locationId)}&itemId=${encodeURIComponent(item.id)}`,{method:'DELETE'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not remove product.');if(editingId===item.id)reset();setMessage('Product removed from the public menu.');await load();}catch(e){setMessage(e instanceof Error?e.message:'Could not remove product.');}
  }

  function inferScanType(value:string){
    if(/^https?:\/\//i.test(value))return 'qr';
    if(/^\d{8,14}$/.test(value.replace(/[\s-]/g,'')))return 'upc';
    return 'barcode';
  }

  async function handleScannedCode(rawValue:string){
    const value=rawValue.trim();
    if(!value)return;
    const type=inferScanType(value);
    setScanValue(value);setScanType(type);setMessage('Looking up scanned product…');setSearching(true);
    try{
      const response=await fetch('/api/weedo-facts/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:value,type:type==='barcode'?undefined:type})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Product scan lookup failed.');
      const record=body.record||null;
      if(!body.found||!record?.productId){
        setHits([]);setSearch('');
        setForm(current=>({...current,productId:''}));
        setMessage('Barcode saved. GeoWeedo does not know this product yet—enter the package details below and add it as an owner-reported menu item.');
        return;
      }

      let hit:ProductHit={id:String(record.productId),productName:String(record.productName||'Scanned product'),brandName:record.brandName||null,productType:record.productType||null,categoryId:null,categoryName:null};
      try{
        const searchResponse=await fetch(`/api/owner/products?locationId=${encodeURIComponent(locationId)}&q=${encodeURIComponent(hit.productName)}`,{cache:'no-store'});
        const searchBody=await searchResponse.json().catch(()=>({}));
        if(searchResponse.ok){
          const exact=(Array.isArray(searchBody.products)?searchBody.products:[]).find((row:ProductHit)=>row.id===hit.id);
          if(exact)hit=exact;
        }
      }catch{}

      setHits([hit]);
      setSearch(`${hit.brandName?`${hit.brandName} · `:''}${hit.productName}`);
      setForm(current=>({...current,productId:hit.id,itemName:hit.productName||current.itemName,brandName:hit.brandName||current.brandName,categoryId:hit.categoryId||current.categoryId,packageSize:record.netContents||current.packageSize}));
      setMessage(`Scanned product matched: ${hit.brandName?`${hit.brandName} · `:''}${hit.productName}. Review price and availability, then add it to the menu.`);
    }catch(e){
      setMessage(e instanceof Error?e.message:'Product scan lookup failed.');
    }finally{setSearching(false);}
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
        <small style={{display:'block',marginBottom:12}}>Scan the package first for the fastest match, or search GeoWeedo manually. Unknown codes can still be added as owner-reported inventory.</small>
        <div style={{marginBottom:12}}>
          <OwnerProductBarcodeScanner disabled={saving||searching} onCode={handleScannedCode} onError={message=>message&&setMessage(message)}/>
          {scanValue?<div style={{marginTop:8,padding:'8px 10px',border:'1px solid var(--border)',borderRadius:10,background:'rgba(103,214,110,.06)',fontSize:12,wordBreak:'break-all'}}><strong>{scanType.toUpperCase()} scanned:</strong> {scanValue}</div>:null}
        </div>
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
