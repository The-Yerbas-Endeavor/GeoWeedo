'use client';

import { useEffect, useMemo, useState } from 'react';
import GuessMap, { type LatLng } from '@/components/GuessMap';
import SiteHeader from '@/components/SiteHeader';

type HuntLocation={id:string;name:string;latitude:number;longitude:number;city?:string;region?:string;country?:string};
type GuessResult={point:LatLng;distanceKm:number;score:number;heat:string};
const MAX_GUESSES=8;
function distanceKm(a:LatLng,b:LatLng){const r=6371.0088,rad=(v:number)=>(v*Math.PI)/180,dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng),lat1=rad(a.lat),lat2=rad(b.lat),h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;return r*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
function heat(km:number){if(km<2)return '🔥 BLAZING';if(km<10)return '🔥 HOT';if(km<40)return '🌡️ WARM';if(km<150)return '🙂 GETTING WARMER';if(km<500)return '🧊 COLD';return '🥶 FREEZING';}
function score(km:number,guessNo:number){const distance=Math.max(0,5000*Math.exp(-km/180));const guessBonus=Math.max(0,(MAX_GUESSES-guessNo)*150);return Math.round(Math.min(5000,distance+guessBonus));}
export default function WeedoHunt(){
 const[locations,setLocations]=useState<HuntLocation[]>([]),[target,setTarget]=useState<HuntLocation|null>(null),[pin,setPin]=useState<LatLng|null>(null),[guesses,setGuesses]=useState<GuessResult[]>([]),[won,setWon]=useState(false),[gaveUp,setGaveUp]=useState(false);
 useEffect(()=>{fetch('/api/map-candidates',{cache:'no-store'}).then(r=>r.json()).then(d=>{const rows=(Array.isArray(d.candidates)?d.candidates:[]).filter((x:any)=>Number.isFinite(x.latitude)&&Number.isFinite(x.longitude));setLocations(rows);if(rows.length)setTarget(rows[Math.floor(Math.random()*rows.length)]);}).catch(()=>{});},[]);
 const finished=won||gaveUp||guesses.length>=MAX_GUESSES;
 const best=useMemo(()=>guesses.length?Math.min(...guesses.map(g=>g.distanceKm)):null,[guesses]);
 const submit=()=>{if(!pin||!target||finished)return;const km=distanceKm(pin,{lat:target.latitude,lng:target.longitude});const result={point:pin,distanceKm:km,score:score(km,guesses.length+1),heat:heat(km)};setGuesses(g=>[...g,result]);if(km<2)setWon(true);setPin(null);};
 const restart=()=>{if(!locations.length)return;let next=locations[Math.floor(Math.random()*locations.length)];if(locations.length>1&&target)while(next.id===target.id)next=locations[Math.floor(Math.random()*locations.length)];setTarget(next);setPin(null);setGuesses([]);setWon(false);setGaveUp(false);};
 return <main className="landing-shell"><SiteHeader/><section className="weedo-hunt-page"><div className="weedo-hunt-heading"><div><div className="eyebrow">GAME MODE</div><h1>🌿 Weedo Hunt</h1><p>A dispensary is hiding somewhere on the map. Drop pins and use the heat meter to hunt it down. Find it within 2 km before you run out of guesses.</p></div><a className="secondary" href="/">Back to GeoWeedo</a></div>{!target?<div className="result-card"><h2>Loading the hunt…</h2><p>Finding a mapped dispensary to hide.</p></div>:<><div className="weedo-hunt-layout"><div className="weedo-hunt-map"><GuessMap guess={pin} actual={finished?{lat:target.latitude,lng:target.longitude}:undefined} revealed={finished} onGuess={setPin}/></div><aside className="result-card weedo-hunt-status"><div className="eyebrow">HUNT STATUS</div><h2>{finished?(won?'🎯 FOUND IT!':'📍 HUNT OVER'):(guesses.length?guesses[guesses.length-1].heat:'Where is Weedo hiding?')}</h2><p>{finished?<><strong>{target.name}</strong><br/>{target.city}{target.city&&target.region?', ':''}{target.region}</>:guesses.length===0?'Start anywhere. Every guess tells you how close you are.':`Best distance: ${best!==null?(best*0.621371).toFixed(best<1?2:1):'—'} miles`}</p><div className="weedo-hunt-guesses">{guesses.map((g,i)=><div key={i}><span>Guess {i+1} · {g.heat}</span><strong>{(g.distanceKm*0.621371).toFixed(g.distanceKm<2?2:0)} mi</strong></div>)}</div>{!finished?<><button className="primary full" disabled={!pin} onClick={submit}>{pin?`Submit Guess ${guesses.length+1} / ${MAX_GUESSES}`:'Drop a Pin on the Map'}</button><button className="secondary full" style={{marginTop:8}} onClick={()=>setGaveUp(true)}>Reveal Location</button></>:<><p><strong>Score:</strong> {(won?guesses[guesses.length-1]?.score:0)?.toLocaleString()} / 5,000</p><button className="primary full" onClick={restart}>Hunt Again</button></>}</aside></div><p className="weedo-hunt-legend">🔥 Hot &lt; 10 km · 🌡️ Warm &lt; 40 km · 🧊 Cold &lt; 500 km · You have {MAX_GUESSES} guesses.</p></>}</section><style jsx global>{`
.weedo-hunt-page{max-width:1360px;margin:0 auto;padding:24px 22px 36px}
.weedo-hunt-heading{display:flex;gap:18px;align-items:end;justify-content:space-between;flex-wrap:wrap;margin-bottom:16px}
.weedo-hunt-heading h1{margin:5px 0 4px;font-size:34px;line-height:1.05}
.weedo-hunt-heading p{margin:0;max-width:760px;color:#dbe3dd}
.weedo-hunt-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(290px,340px);gap:16px;align-items:stretch}
.weedo-hunt-map{height:clamp(540px,68vh,760px);min-width:0;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.12);background:#202820}
.weedo-hunt-map .guess-map-wrap{height:100%!important;min-height:100%;margin:0!important;border-radius:0!important}
.weedo-hunt-map .guess-map-canvas{height:100%!important;min-height:100%}
.weedo-hunt-status{margin:0!important;text-align:left!important;max-width:none!important;width:100%!important;padding:28px!important;overflow:auto}
.weedo-hunt-status h2{margin:14px 0 12px}
.weedo-hunt-guesses{display:grid;gap:8px;margin:18px 0;max-height:320px;overflow:auto}
.weedo-hunt-guesses>div{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.05)}
.weedo-hunt-legend{opacity:.72;margin:12px 2px 0}
@media(max-width:900px){.weedo-hunt-page{padding:18px 14px 28px}.weedo-hunt-layout{grid-template-columns:1fr}.weedo-hunt-map{height:clamp(460px,62vh,640px)}.weedo-hunt-status{padding:22px!important}.weedo-hunt-heading{align-items:start}.weedo-hunt-heading h1{font-size:30px}}
@media(max-width:560px){.weedo-hunt-page{padding:14px 10px 24px}.weedo-hunt-heading{margin-bottom:12px}.weedo-hunt-heading h1{font-size:27px}.weedo-hunt-heading p{font-size:14px}.weedo-hunt-map{height:58vh;min-height:390px;border-radius:14px}.weedo-hunt-status{padding:18px!important}.weedo-hunt-legend{font-size:12px;line-height:1.45}}
`}</style></main>;
}
