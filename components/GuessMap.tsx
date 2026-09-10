'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import MapLibreGuessMap,{type LatLng,type MapLocation} from '@/components/GuessMapLegacy';
import GoogleGuessMap from '@/components/GoogleGuessMap';

export type {LatLng,MapLocation};

type Props={guess:LatLng|null;actual?:LatLng|null;revealed?:boolean;onGuess:(guess:LatLng)=>void;locations?:MapLocation[];browseMode?:boolean;mappedTotal?:number;countriesTotal?:number;enabledTotal?:number;showAllMappedPins?:boolean};
type ProductMatch={menuItemId:string;productId:string|null;batchId:string|null;itemName:string;brandName:string|null;category:string|null;variant:string|null;packageSize:string|null;priceCents:number|null;currency:string;inventoryStatus:string;verified:boolean;sourceUpdatedAt:string|null;batchNumber:string|null;score:number};
type ProductDispensary={id:string;name:string;city:string|null;region:string|null;country:string|null;latitude:number;longitude:number;matches:ProductMatch[]};

function formatPrice(match:ProductMatch){if(match.priceCents===null)return null;try{return new Intl.NumberFormat(undefined,{style:'currency',currency:match.currency||'USD'}).format(match.priceCents/100);}catch{return `$${(match.priceCents/100).toFixed(2)}`;}}
function clearProductParam(){const url=new URL(window.location.href);url.searchParams.delete('product');url.searchParams.delete('productId');window.history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);}

function ProductAwareMap(props:Props){
 const rootRef=useRef<HTMLDivElement|null>(null);
 const[toolbar,setToolbar]=useState<HTMLElement|null>(null),[locationCard,setLocationCard]=useState<HTMLElement|null>(null),[selectedLocationId,setSelectedLocationId]=useState('');
 const[query,setQuery]=useState(''),[debouncedQuery,setDebouncedQuery]=useState(''),[resultQuery,setResultQuery]=useState('');
 const[exactProductId,setExactProductId]=useState(''),[exactProductLabel,setExactProductLabel]=useState('');
 const[results,setResults]=useState<ProductDispensary[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');

 useEffect(()=>{const params=new URLSearchParams(window.location.search);const id=String(params.get('product')||params.get('productId')||'').trim();if(id){setExactProductId(id);document.body.classList.add('geoweedo-findo-active');window.setTimeout(()=>document.querySelector<HTMLButtonElement>('.map-first-home .home-promo-close')?.click(),0);}},[]);
 useEffect(()=>{const timer=window.setTimeout(()=>setDebouncedQuery(query.trim()),260);return()=>window.clearTimeout(timer);},[query]);
 useEffect(()=>{
  const root=rootRef.current;if(!root)return;
  const sync=()=>{const nextToolbar=root.querySelector<HTMLElement>('.map-browser-tools');const nextCard=root.querySelector<HTMLElement>('.map-location-card');setToolbar(nextToolbar);setLocationCard(nextCard);setSelectedLocationId(nextCard?.dataset.locationId||'');};
  sync();const observer=new MutationObserver(sync);observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['data-location-id']});return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const exactId=exactProductId.trim(),q=debouncedQuery.trim();
  if(!exactId&&q.length<2){setResults([]);setResultQuery('');setLoading(false);setError('');return;}
  const controller=new AbortController();setLoading(true);setError('');
  const endpoint=exactId?`/api/dispensaries/product-search?productId=${encodeURIComponent(exactId)}`:`/api/dispensaries/product-search?q=${encodeURIComponent(q)}`;
  fetch(endpoint,{cache:'no-store',signal:controller.signal})
   .then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Product search failed.');return data;})
   .then(data=>{const next=Array.isArray(data.dispensaries)?data.dispensaries:[];const label=exactId?String(data.product?.label||data.product?.productName||'Selected product'):q;setResults(next);setResultQuery(label);if(exactId)setExactProductLabel(label);setLoading(false);rootRef.current?.querySelector<HTMLButtonElement>('.map-location-close')?.click();window.setTimeout(()=>{const panel=rootRef.current?.querySelector<HTMLElement>('.map-browser-panel');if(panel)return;const button=Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('.map-browser-tools button')||[]).find(item=>/^Browse list\s*\(/i.test(item.textContent?.trim()||''));button?.click();},20);})
   .catch(err=>{if(controller.signal.aborted)return;setResults([]);setResultQuery('');setLoading(false);setError(err instanceof Error?err.message:'Product search failed.');});
  return()=>controller.abort();
 },[debouncedQuery,exactProductId]);

 const productFilterActive=resultQuery.length>=2&&!loading&&!error;
 const resultMap=useMemo(()=>new Map(results.map(item=>[String(item.id),item])),[results]);
 const productLocations=useMemo(()=>{
  if(!productFilterActive)return props.locations||[];
  const originals=new Map((props.locations||[]).map(item=>[String(item.id),item]));
  return results.map(result=>{
   const original=originals.get(String(result.id));
   if(original)return original;
   return {id:result.id,name:result.name,lat:Number(result.latitude),lng:Number(result.longitude),city:result.city||'',region:result.region||'',country:result.country||'USA',approved:true,enabled:true,imageryReady:false,source:'Dispensary menu'} as MapLocation;
  }).filter(item=>Number.isFinite(item.lat)&&Number.isFinite(item.lng));
 },[productFilterActive,props.locations,results]);
 const productCountries=useMemo(()=>new Set(productLocations.map(item=>item.country).filter(Boolean)).size,[productLocations]);
 const selectedMatch=resultMap.get(selectedLocationId);
 const inputValue=exactProductId?(exactProductLabel||'Selected Weedo Facts product'):query;
 const clearSearch=()=>{setExactProductId('');setExactProductLabel('');setQuery('');setDebouncedQuery('');setResults([]);setResultQuery('');setError('');clearProductParam();};
 const searchControl=toolbar?createPortal(<div className="map-product-search" style={{display:'flex',alignItems:'center',gap:6,position:'relative'}}>
   <input className="map-product-search-input" value={inputValue} onChange={event=>{if(exactProductId){setExactProductId('');setExactProductLabel('');clearProductParam();}setQuery(event.target.value);}} placeholder="Search product or brand" aria-label="Search product or brand" autoComplete="off" style={{minWidth:180,maxWidth:280}}/>
   {inputValue?<button type="button" onClick={clearSearch} aria-label="Clear product search" title="Clear product search">×</button>:null}
   {loading?<span style={{fontSize:12,whiteSpace:'nowrap'}}>Finding product…</span>:productFilterActive?<span style={{fontSize:12,whiteSpace:'nowrap'}}>{exactProductId?'Exact product · ':''}{results.length} {results.length===1?'store':'stores'}</span>:error?<span style={{fontSize:12,whiteSpace:'nowrap'}} title={error}>Product search unavailable</span>:null}
  </div>,toolbar):null;
 const matchCard=locationCard&&selectedMatch?createPortal(<div className="map-location-product-matches" style={{marginTop:12,padding:'10px 12px',borderRadius:10,background:'rgba(72,160,91,.12)',border:'1px solid rgba(103,214,110,.28)'}}>
   <strong style={{display:'block',marginBottom:6}}>🌿 {exactProductId?'THIS PRODUCT':'PRODUCT MATCHES'}</strong>
   {selectedMatch.matches.slice(0,4).map(match=><div key={match.menuItemId} style={{padding:'6px 0',borderTop:'1px solid rgba(255,255,255,.08)'}}>
    <div style={{fontWeight:800}}>{match.brandName?`${match.brandName} · `:''}{match.itemName}</div>
    <small>{[match.variant,match.packageSize,formatPrice(match),match.inventoryStatus&&match.inventoryStatus!=='unknown'?match.inventoryStatus.replace(/_/g,' '):null].filter(Boolean).join(' · ')||'Listed on dispensary menu'}{match.verified?' · ✓ source-backed':''}</small>
   </div>)}
   {selectedMatch.matches.length>4?<small>+{selectedMatch.matches.length-4} more matching menu items</small>:null}
  </div>,locationCard):null;

 return <div ref={rootRef} style={{position:'relative',width:'100%',height:'100%'}}>
   <MapLibreGuessMap {...props} locations={productLocations} mappedTotal={productFilterActive?productLocations.length:props.mappedTotal} enabledTotal={productFilterActive?productLocations.filter(item=>item.enabled).length:props.enabledTotal} countriesTotal={productFilterActive?productCountries:props.countriesTotal}/>
   {searchControl}
   {matchCard}
  </div>;
}

export default function GuessMapRouter(props:Props){
 const[googleUnavailable,setGoogleUnavailable]=useState(false);
 if(props.browseMode)return <ProductAwareMap {...props}/>;
 if(googleUnavailable)return <MapLibreGuessMap {...props}/>;
 return <GoogleGuessMap guess={props.guess} actual={props.actual} revealed={props.revealed} onGuess={props.onGuess} onUnavailable={()=>setGoogleUnavailable(true)}/>;
}
