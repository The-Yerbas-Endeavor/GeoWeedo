'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import GuessMap, { LatLng } from '@/components/GuessMap';
import SiteHeader from '@/components/SiteHeader';
import StreetViewStage from '@/components/StreetViewStage';
import { dispensaries, type Dispensary } from '@/data/dispensaries';
import { DEFAULT_YERB_PER_POINT, yerbFromScore } from '@/lib/yerbasRewards';

const MAX_SCORE = 5000;

type PublicMapCandidate = { id:string; name:string; latitude:number; longitude:number; city?:string; region?:string; country?:string; dataSource?:string; status?:string; imageryStatus?:string; mapCandidate?:boolean };
type PublicMapStats = { total:number; mapped:number; missingCoordinates:number; states:number };

function distanceKm(a:LatLng,b:LatLng){const radiusKm=6371.0088,toRadians=(value:number)=>(value*Math.PI)/180,dLat=toRadians(b.lat-a.lat),dLng=toRadians(b.lng-a.lng),lat1=toRadians(a.lat),lat2=toRadians(b.lat),haversine=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;return radiusKm*2*Math.atan2(Math.sqrt(haversine),Math.sqrt(1-haversine));}
function scoreFromDistance(km:number){return Math.max(0,Math.min(MAX_SCORE,Math.round(MAX_SCORE*Math.exp(-km/500))));}

export default function HomePage(){
  const [started,setStarted]=useState(false),[round,setRound]=useState(0),[scores,setScores]=useState<number[]>([]),[guess,setGuess]=useState<LatLng|null>(null),[revealed,setRevealed]=useState(false),[roundDistance,setRoundDistance]=useState<number|null>(null),[roundScore,setRoundScore]=useState<number|null>(null),[approvedDispensaries,setApprovedDispensaries]=useState<Dispensary[]>([]),[mapCandidates,setMapCandidates]=useState<PublicMapCandidate[]>([]),[mapStats,setMapStats]=useState<PublicMapStats|null>(null);

  useEffect(()=>{
    fetch('/api/dispensaries',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(new Error('Failed to load approved dispensaries.'))).then(d=>setApprovedDispensaries(Array.isArray(d.dispensaries)?d.dispensaries:[])).catch(()=>setApprovedDispensaries([]));
    fetch('/api/map-candidates',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(new Error('Failed to load map candidates.'))).then(d=>{setMapCandidates(Array.isArray(d.candidates)?d.candidates:[]);setMapStats(d.stats&&typeof d.stats==='object'?d.stats:null);}).catch(()=>{setMapCandidates([]);setMapStats(null);});
  },[]);

  const rounds=useMemo(()=>{
    const approved=approvedDispensaries.filter(item=>item.active&&item.verified&&item.imageryPhotoId);
    const featured=approved.filter(item=>item.sponsored).sort((a,b)=>(b.sponsorPriority||0)-(a.sponsorPriority||0)).slice(0,1);
    const organic=approved.filter(item=>!item.sponsored);
    return [...featured,...organic].slice(0,5);
  },[approvedDispensaries]);

  const homeLocations=useMemo(()=>{
    const merged=[
      ...approvedDispensaries.filter(item=>item.active).map(item=>({id:item.id,name:item.name,lat:item.latitude,lng:item.longitude,city:item.city,region:item.region,sponsored:item.sponsored,approved:true})),
      ...mapCandidates.map(item=>({id:item.id,name:item.name,lat:item.latitude,lng:item.longitude,city:item.city||'',region:item.region||'',sponsored:false,approved:false})),
      ...dispensaries.filter(item=>item.active).map(item=>({id:item.id,name:item.name,lat:item.latitude,lng:item.longitude,city:item.city,region:item.region,sponsored:item.sponsored,approved:false})),
    ];
    const seen=new Set<string>();
    return merged.filter(item=>{if(!Number.isFinite(item.lat)||!Number.isFinite(item.lng))return false;const key=`${item.name}|${item.lat.toFixed(5)}|${item.lng.toFixed(5)}`.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
  },[approvedDispensaries,mapCandidates]);

  const current=rounds[round],total=scores.reduce((sum,value)=>sum+value,0),completedTotal=total+(revealed&&roundScore!==null?roundScore:0),estimatedYerb=yerbFromScore(completedTotal,DEFAULT_YERB_PER_POINT),onGuess=useCallback((value:LatLng)=>setGuess(value),[]);
  const beginGame=()=>{setStarted(true);setRound(0);setScores([]);setGuess(null);setRevealed(false);setRoundDistance(null);setRoundScore(null);};
  const revealGuess=()=>{if(!guess||!current)return;const actual={lat:current.latitude,lng:current.longitude},distance=distanceKm(guess,actual);setRoundDistance(distance);setRoundScore(scoreFromDistance(distance));setRevealed(true);};
  const nextRound=()=>{if(roundScore===null)return;setScores(previous=>[...previous,roundScore]);setRound(previous=>previous+1);setGuess(null);setRevealed(false);setRoundDistance(null);setRoundScore(null);};

  if(!started)return <main className="landing-shell map-first-home"><SiteHeader/><section className="home-map-stage"><div className="home-map-canvas"><GuessMap guess={null} revealed={false} onGuess={()=>{}} browseMode locations={homeLocations}/></div><div className="home-play-card"><div className="eyebrow">THE DISPENSARY GEOGRAPHY GAME</div><h1>GeoWeedo</h1><p>Explore real dispensary locations, read the clues, and pinpoint where you are.</p><button className="primary home-play-button" onClick={beginGame} disabled={rounds.length===0}>{rounds.length?`Play GeoWeedo · ${rounds.length} round${rounds.length===1?'':'s'}`:'No quality-approved rounds yet'}</button><div className="home-play-meta"><span>{rounds.length} playable</span><span>{homeLocations.length.toLocaleString()} mapped</span>{mapStats&&<span>{mapStats.total.toLocaleString()} candidates</span>}{mapStats&&<span>{mapStats.states} states</span>}<span>YERB rewards</span></div>{rounds.length===0&&<p className="map-coverage-note">Browse locations are visible, but gameplay stays disabled until imagery passes the quality validator.</p>}{mapStats&&mapStats.missingCoordinates>0&&<p className="map-coverage-note">{mapStats.missingCoordinates.toLocaleString()} imported locations still need coordinates before they can appear on the public map.</p>}</div></section></main>;

  if(!current){
    if(scores.length===0)return <main className="result-shell"><div className="result-card"><div className="eyebrow">NO PLAYABLE ROUNDS</div><h1>0</h1><p>GeoWeedo only starts rounds with quality-approved navigable imagery. Validate a 360° panorama or a qualifying landscape KartaView sequence in Admin.</p><a className="primary" href="/">Back to map</a></div></main>;
    return <main className="result-shell"><div className="result-card"><div className="eyebrow">GAME COMPLETE</div><h1>{total.toLocaleString()} <small>/ {(rounds.length*MAX_SCORE).toLocaleString()}</small></h1><p className="yerb-score">Estimated eligible reward: {yerbFromScore(total,DEFAULT_YERB_PER_POINT)} YERB</p><p>Verified reward accounts enter the auditable payout ledger after server-side game validation is enabled.</p><div className="score-list">{scores.map((score,index)=><div key={index}><span>Round {index+1}</span><strong>{score.toLocaleString()}</strong></div>)}</div><button className="primary" onClick={beginGame}>Play again</button></div></main>;
  }

  const actual={lat:current.latitude,lng:current.longitude};
  return <main className="game-shell"><header className="game-header"><a className="brand brand-link" href="/"><span className="brand-pin">✦</span> GEOWEEDO</a><div className="round-meter">ROUND {round+1} / {rounds.length}</div><div className="running-score">{completedTotal.toLocaleString()} pts · <span className="yerb-score">~{estimatedYerb} YERB</span></div></header><section className="panorama-stage live-panorama"><StreetViewStage latitude={current.imageryLatitude??current.latitude} longitude={current.imageryLongitude??current.longitude} heading={current.imageryHeading??current.heading} photoId={current.imageryPhotoId} imageryProvider={current.imageryProvider} imageUrl={current.imageryUrl} projection={current.imageryProjection} fieldOfView={current.imageryFieldOfView}/><aside className="guess-card live-guess-card"><GuessMap guess={guess} actual={actual} revealed={revealed} onGuess={onGuess}/>{!revealed?<div className="guess-actions"><div className="guess-status">{guess?'Pin placed — move it by clicking elsewhere.':'Place a pin where you think the dispensary is.'}</div><button className="primary full" disabled={!guess} onClick={revealGuess}>{guess?'Make Guess':'Place a Pin First'}</button></div>:<div className="reveal"><span className="eyebrow">ACTUAL LOCATION</span><h3>{current.name}</h3><p>{current.city}, {current.region}{current.sponsored?' · Featured':''}</p><div className="reveal-stat"><span>Distance</span><strong>{roundDistance===null?'—':roundDistance<1?`${Math.round(roundDistance*1000)} m`:`${roundDistance.toFixed(1)} km`}</strong></div><div className="reveal-stat"><span>Score</span><strong>{roundScore?.toLocaleString()??'—'}</strong></div><div className="reveal-stat"><span>Estimated YERB</span><strong className="yerb-score">{roundScore===null?'—':yerbFromScore(roundScore,DEFAULT_YERB_PER_POINT)}</strong></div><button className="primary full" onClick={nextRound}>{round+1===rounds.length?'See Results':'Next Round'}</button></div>}</aside></section></main>;
}
