'use client';

import {FormEvent,useEffect,useState} from 'react';
import styles from './ProductSightingReporter.module.css';

type Dispensary={id:string;name:string;city:string|null;region:string|null;country:string|null;distanceMiles?:number|null};

export default function ProductSightingReporter({
  productId,
  batchId,
  source='user',
}:{productId:string;batchId?:string|null;source?:'scanner'|'user'}){
  const[query,setQuery]=useState('');
  const[results,setResults]=useState<Dispensary[]>([]);
  const[selected,setSelected]=useState<Dispensary|null>(null);
  const[price,setPrice]=useState('');
  const[saving,setSaving]=useState(false);
  const[message,setMessage]=useState('');
  const[error,setError]=useState('');
  const[locating,setLocating]=useState(false);

  useEffect(()=>{
    const value=query.trim();
    if(value.length<2){setResults([]);return;}
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      fetch('/api/dispensaries/search?q='+encodeURIComponent(value),{cache:'no-store',signal:controller.signal})
        .then(response=>response.ok?response.json():Promise.reject())
        .then(body=>setResults(Array.isArray(body.dispensaries)?body.dispensaries:[]))
        .catch(()=>{});
    },220);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[query]);

  function useLocation(){
    if(!navigator.geolocation){setError('Location is not available in this browser.');return;}
    setLocating(true);setError('');setMessage('');
    navigator.geolocation.getCurrentPosition(async position=>{
      try{
        const params=new URLSearchParams({lat:String(position.coords.latitude),lng:String(position.coords.longitude)});
        const response=await fetch('/api/dispensaries/search?'+params.toString(),{cache:'no-store'});
        const body=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(body.error||'Could not find nearby dispensaries.');
        const rows=Array.isArray(body.dispensaries)?body.dispensaries:[];
        setResults(rows);setQuery('');
        if(!rows.length)setMessage('No mapped dispensaries were found near your current location.');
      }catch(cause){setError(cause instanceof Error?cause.message:'Could not find nearby dispensaries.');}
      finally{setLocating(false);}
    },error=>{
      setLocating(false);
      setError(error.code===1?'Location permission was not granted. You can still search manually.':'Could not determine your location. You can still search manually.');
    },{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
  }

  async function submit(event:FormEvent){
    event.preventDefault();
    if(!selected)return;
    setSaving(true);setMessage('');setError('');
    try{
      const response=await fetch('/api/weedo-facts/availability/observations',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          productId,
          batchId:batchId||null,
          dispensaryId:selected.id,
          sourceType:source,
          availabilityStatus:'seen',
          price:price.trim()||null,
        }),
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Could not save this sighting.');
      setMessage(source==='scanner'
        ? 'Thanks — this scan now contributes to GeoWeedo availability.'
        : 'Thanks — this product sighting was recorded.');
      setQuery('');setResults([]);setSelected(null);setPrice('');
      window.dispatchEvent(new CustomEvent('geoweedo:availability-updated',{detail:{productId}}));
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Could not save this sighting.');
    }finally{setSaving(false);}
  }

  return <details className={styles.shell}>
    <summary>{source==='scanner'?'Where did you find this?':'Seen this product at a dispensary?'}</summary>
    <form onSubmit={submit}>
      <p>{source==='scanner'
        ? 'Connect this package scan to the dispensary where you found it.'
        : 'Add a recent sighting. GeoWeedo treats it as time-limited evidence, not guaranteed live inventory.'}</p>

      {!selected?<div className={styles.search}>
        <label>Dispensary
          <button className={styles.location} type="button" onClick={useLocation} disabled={locating}>{locating?'Finding nearby…':'Use my location'}</button>
          <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search dispensary, city, or state" autoComplete="off"/>
        </label>
        {results.length?<div className={styles.results}>{results.map(row=><button type="button" key={row.id} onClick={()=>{setSelected(row);setResults([]);}}>
          <strong>{row.name}</strong>
          <span>{[row.city,row.region].filter(Boolean).join(', ')||'Location details'}{Number.isFinite(row.distanceMiles)?` · ${Number(row.distanceMiles).toFixed(Number(row.distanceMiles)<10?1:0)} mi`:''}</span>
        </button>)}</div>:null}
      </div>:<div className={styles.selected}>
        <div><strong>{selected.name}</strong><span>{[selected.city,selected.region].filter(Boolean).join(', ')}</span></div>
        <button type="button" onClick={()=>setSelected(null)}>Change</button>
      </div>}

      <label className={styles.price}>Price <span>optional</span>
        <input value={price} onChange={event=>setPrice(event.target.value)} inputMode="decimal" placeholder="35.00"/>
      </label>
      <button className={styles.save} type="submit" disabled={!selected||saving}>{saving?'Saving…':source==='scanner'?'Save scan location':'Report sighting'}</button>
      {error?<p className={styles.error}>{error} {error.startsWith('Login required')?<a href="/account">Log in or create an account</a>:null}</p>:null}
      {message?<p className={styles.success}>{message}</p>:null}
    </form>
  </details>;
}
