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

function ProductAwareMap(props:Props){
 const rootRef=useRef<HTMLDivElement|null>(null);
 const[toolbar,setToolbar]=useState<HTMLElement|null>(null),[locationCard,setLocationCard]=useState<HTMLElement|null>(null);
 const[query,setQuery]=useState(''),[debouncedQuery,setDebouncedQuery]=useState(''),[resultQuery,setResultQuery]=useState('');
 const[results,setResults]=useState<ProductDispensary[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');

 useEffect(()=>{const timer=window.setTimeout(()=>setDebouncedQuery(query.trim()),260);return()=>window.clearTimeout(timer);},[query]);
 useEffect(()=>{
  const root=rootRef.current;if(!root)return;
  const sync=()=>{setToolbar(root.querySelector<HTMLElement>('.map-browser-tools'));setLocationCard(root.querySelector<HTMLElement>('.map-location-card'));};
  sync();const observer=new MutationObserver(sync);observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['data-location-id']});return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const q=debouncedQuery.trim();
  if(q.length<2){setResults([]);setResultQuery('');setLoading(false);setError('');return;}
  const controller=new AbortController();setLoading(true);setError('');
  fetch(`/api/dispensaries/product-search?q=${encodeURIComponent(q)}`,{cache:'no-store',signal:controller.signal})
   .then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Product search failed.');return data;})
   .then(data=>{const next=Array.isArray(data.dispensaries)?data.dispensaries:[];setResults(next);setResultQuery(q);setLoading(false);rootRef.current?.querySelector<HTMLButtonElement>('.map-location-close')?.click();})
   .catch(err=>{if(controller.signal.aborted)return;setResults([]);setResultQuery(q);setLoading(false);setError(err instanceof Error?err.message:'Product search failed.');});
  return()=>controller.abort();
 },[debouncedQuery]);

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
 const selectedId=locationCard?.dataset.locationId||'';
 const selectedMatch=resultMap.get(selectedId);
 const searchControl=toolbar?createPortal(<div className="map-product-search" style={{display:'flex',alignItems:'center',gap:6,position:'relative'}}>
   <input className="map-product-search-input" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search product or brand" aria-label="Search product or brand" autoComplete="off" style={{minWidth:180,maxWidth:280}}/>
   {query?<button type="button" onClick={()=>{setQuery('');setDebouncedQuery('');setResults([]);setResultQuery('');setError('');}} aria-label="Clear product search" title="Clear product search">×</button>:null}
   {loading?<span style={{fontSize:12,whiteSpace:'nowrap'}}>Searching products…</span>:productFilterActive?<span style={{fontSize:12,whiteSpace:'nowrap'}}>{results.length} {results.length===1?'store':'stores'}</span>:error?<span style={{fontSize:12,whiteSpace:'nowrap'}} title={error}>Product search unavailable</span>:null}
  </div>,toolbar):null;
 const matchCard=locationCard&&selectedMatch?createPortal(<div className="map-location-product-matches" style={{marginTop:12,padding:'10px 12px',borderRadius:10,background:'rgba(72,160,91,.12)',border:'1px solid rgba(103,214,110,.28)'}}>
   <strong style={{display:'block',marginBottom:6}}>🌿 PRODUCT MATCHES</strong>
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
