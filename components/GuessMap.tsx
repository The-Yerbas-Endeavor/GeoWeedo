'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import MapLibreGuessMap,{type LatLng,type MapLocation} from '@/components/GuessMapLegacy';
import GoogleGuessMap from '@/components/GoogleGuessMap';

export type {LatLng,MapLocation};

type Props={guess:LatLng|null;actual?:LatLng|null;revealed?:boolean;onGuess:(guess:LatLng)=>void;locations?:MapLocation[];browseMode?:boolean;mappedTotal?:number;countriesTotal?:number;enabledTotal?:number;showAllMappedPins?:boolean};
type ProductMatch={menuItemId:string;productId:string|null;batchId:string|null;itemName:string;brandName:string|null;category:string|null;variant:string|null;packageSize:string|null;priceCents:number|null;currency:string;inventoryStatus:string;verified:boolean;sourceUpdatedAt:string|null;batchNumber:string|null;score:number};
type ProductDispensary={id:string;name:string;city:string|null;region:string|null;country:string|null;latitude:number;longitude:number;matches:ProductMatch[]};

const ZIP_QUERY=/^\d{5}(?:-\d{4})?$/;
const SEARCH_ACTIVE_CLASS='geoweedo-map-search-active';

function formatPrice(match:ProductMatch){if(match.priceCents===null)return null;try{return new Intl.NumberFormat(undefined,{style:'currency',currency:match.currency||'USD'}).format(match.priceCents/100);}catch{return `$${(match.priceCents/100).toFixed(2)}`;}}
function clearProductParam(){const url=new URL(window.location.href);url.searchParams.delete('product');url.searchParams.delete('productId');window.history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);}
function setNativeInputValue(input:HTMLInputElement,value:string){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(setter)setter.call(input,value);else input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
function textMatchesLocation(item:MapLocation,query:string){return `${item.name} ${item.city||''} ${item.region||''} ${item.country||''}`.toLowerCase().includes(query.toLowerCase());}

function ProductAwareMap(props:Props){
 const rootRef=useRef<HTMLDivElement|null>(null);
 const[toolbar,setToolbar]=useState<HTMLElement|null>(null),[legacySearchInput,setLegacySearchInput]=useState<HTMLInputElement|null>(null),[locationCard,setLocationCard]=useState<HTMLElement|null>(null),[selectedLocationId,setSelectedLocationId]=useState('');
 const[query,setQuery]=useState(''),[debouncedQuery,setDebouncedQuery]=useState(''),[resultQuery,setResultQuery]=useState('');
 const[exactProductId,setExactProductId]=useState(''),[exactProductLabel,setExactProductLabel]=useState('');
 const[results,setResults]=useState<ProductDispensary[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');

 useEffect(()=>{const params=new URLSearchParams(window.location.search);const id=String(params.get('product')||params.get('productId')||'').trim();if(id){setExactProductId(id);document.body.classList.add('geoweedo-findo-active',SEARCH_ACTIVE_CLASS);window.setTimeout(()=>document.querySelector<HTMLButtonElement>('.map-first-home .home-promo-close')?.click(),0);}},[]);
 useEffect(()=>{const timer=window.setTimeout(()=>setDebouncedQuery(query.trim()),260);return()=>window.clearTimeout(timer);},[query]);
 useEffect(()=>{
  const root=rootRef.current;if(!root)return;
  const sync=()=>{
   const nextToolbar=root.querySelector<HTMLElement>('.map-browser-tools');
   const nextLegacy=nextToolbar?.querySelector<HTMLInputElement>('input:not(.map-unified-search-input)')||null;
   if(nextLegacy){nextLegacy.style.display='none';nextLegacy.setAttribute('aria-hidden','true');nextLegacy.tabIndex=-1;nextLegacy.dataset.unifiedSearchInternal='1';}
   const nextCard=root.querySelector<HTMLElement>('.map-location-card');
   setToolbar(nextToolbar);setLegacySearchInput(nextLegacy);setLocationCard(nextCard);setSelectedLocationId(nextCard?.dataset.locationId||'');
  };
  sync();const observer=new MutationObserver(sync);observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['data-location-id']});return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  if(!legacySearchInput)return;
  const value=query.trim();
  if(ZIP_QUERY.test(value)){if(legacySearchInput.value!==value)setNativeInputValue(legacySearchInput,value);}
  else if(legacySearchInput.value)setNativeInputValue(legacySearchInput,'');
  const active=Boolean(value||exactProductId);document.body.classList.toggle(SEARCH_ACTIVE_CLASS,active);
  if(active)document.querySelector<HTMLButtonElement>('.map-first-home .home-promo-close')?.click();
 },[query,exactProductId,legacySearchInput]);
 useEffect(()=>{
  const exactId=exactProductId.trim(),q=debouncedQuery.trim(),isZip=ZIP_QUERY.test(q);
  if(!exactId&&(q.length<2||isZip)){setResults([]);setResultQuery('');setLoading(false);setError('');return;}
  const controller=new AbortController();setLoading(true);setError('');
  const endpoint=exactId?`/api/dispensaries/product-search?productId=${encodeURIComponent(exactId)}`:`/api/dispensaries/product-search?q=${encodeURIComponent(q)}`;
  fetch(endpoint,{cache:'no-store',signal:controller.signal})
   .then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Product search failed.');return data;})
   .then(data=>{const next=Array.isArray(data.dispensaries)?data.dispensaries:[];const label=exactId?String(data.product?.label||data.product?.productName||'Selected product'):q;setResults(next);setResultQuery(label);if(exactId)setExactProductLabel(label);setLoading(false);rootRef.current?.querySelector<HTMLButtonElement>('.map-location-close')?.click();window.setTimeout(()=>{const panel=rootRef.current?.querySelector<HTMLElement>('.map-browser-panel');if(panel)return;const button=Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('.map-browser-tools button')||[]).find(item=>/^Browse list\s*\(/i.test(item.textContent?.trim()||''));button?.click();},20);})
   .catch(err=>{if(controller.signal.aborted)return;setResults([]);setResultQuery('');setLoading(false);setError(err instanceof Error?err.message:'Product search failed.');});
  return()=>controller.abort();
 },[debouncedQuery,exactProductId]);

 const resultMap=useMemo(()=>new Map(results.map(item=>[String(item.id),item])),[results]);
 const activeTextQuery=!exactProductId&&!ZIP_QUERY.test(debouncedQuery.trim())&&debouncedQuery.trim().length>=2?debouncedQuery.trim():'';
 const unifiedFilterActive=Boolean(exactProductId&&resultQuery)||Boolean(activeTextQuery);
 const combinedLocations=useMemo(()=>{
  const originals=props.locations||[];
  if(!unifiedFilterActive)return originals;
  const originalById=new Map(originals.map(item=>[String(item.id),item]));
  const combined=new Map<string,MapLocation>();
  if(!exactProductId&&activeTextQuery){for(const item of originals){if(textMatchesLocation(item,activeTextQuery))combined.set(String(item.id),item);}}
  for(const result of results){const original=originalById.get(String(result.id));const item=original||({id:result.id,name:result.name,lat:Number(result.latitude),lng:Number(result.longitude),city:result.city||'',region:result.region||'',country:result.country||'USA',approved:true,enabled:true,imageryReady:false,source:'Dispensary menu'} as MapLocation);if(Number.isFinite(item.lat)&&Number.isFinite(item.lng))combined.set(String(item.id),item);}
  return [...combined.values()];
 },[activeTextQuery,exactProductId,props.locations,results,unifiedFilterActive]);
 const productCountries=useMemo(()=>new Set(combinedLocations.map(item=>item.country).filter(Boolean)).size,[combinedLocations]);
 const selectedMatch=resultMap.get(selectedLocationId);
 const inputValue=exactProductId?(exactProductLabel||'Selected Weedo Facts product'):query;
 const clearSearch=()=>{setExactProductId('');setExactProductLabel('');setQuery('');setDebouncedQuery('');setResults([]);setResultQuery('');setError('');if(legacySearchInput?.value)setNativeInputValue(legacySearchInput,'');document.body.classList.remove(SEARCH_ACTIVE_CLASS);window.dispatchEvent(new CustomEvent('geoweedo:zip-radius-clear'));clearProductParam();};
 const searchControl=toolbar?createPortal(<div className="map-unified-search" style={{display:'flex',alignItems:'center',gap:6,position:'relative',minWidth:0,flex:'1 1 300px',maxWidth:420}}>
   <input className="map-unified-search-input" value={inputValue} onChange={event=>{if(exactProductId){setExactProductId('');setExactProductLabel('');clearProductParam();}setQuery(event.target.value);}} placeholder="Search dispensary, product, brand or ZIP" aria-label="Search dispensary, product, brand or ZIP" autoComplete="off" style={{width:'100%',minWidth:180}}/>
   {inputValue?<button type="button" onClick={clearSearch} aria-label="Clear search" title="Clear search">×</button>:null}
   {loading?<span aria-label="Searching products" title="Searching products" style={{fontSize:12,whiteSpace:'nowrap'}}>…</span>:error?<span aria-label="Product search unavailable" title={error} style={{fontSize:12,whiteSpace:'nowrap'}}>!</span>:null}
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
   <MapLibreGuessMap {...props} locations={combinedLocations} mappedTotal={unifiedFilterActive?combinedLocations.length:props.mappedTotal} enabledTotal={unifiedFilterActive?combinedLocations.filter(item=>item.enabled).length:props.enabledTotal} countriesTotal={unifiedFilterActive?productCountries:props.countriesTotal}/>
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
