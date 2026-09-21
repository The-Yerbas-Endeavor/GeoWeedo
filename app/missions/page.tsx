'use client';

import { useEffect, useMemo, useState } from 'react';
import SiteHeader from '@/components/SiteHeader';
import StreetViewStage from '@/components/StreetViewStage';
import GuessMap, { type LatLng } from '@/components/GuessMap';
import styles from './mission.module.css';

type MissionPayload={
  campaignId:string;
  title:string;
  startsAt:string;
  endsAt:string;
  start:{lat:number;lng:number;approxDistanceKm:number};
  target:{lat:number;lng:number};
  reveal:{
    id:string;
    name:string;
    city:string;
    region:string;
    country:string;
    website:string|null;
    logo:string|null;
    profileHref:string;
  };
};

function distanceKm(a:LatLng,b:LatLng){
  const r=6371.0088,rad=(v:number)=>(v*Math.PI)/180;
  const dLat=rad(b.lat-a.lat),dLng=rad(b.lng-a.lng),lat1=rad(a.lat),lat2=rad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return r*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function missionScore(km:number,elapsedSeconds:number){
  const distancePoints=Math.round(5000*Math.exp(-km/1.5));
  const timePoints=Math.max(0,1000-Math.floor(elapsedSeconds/3));
  return Math.max(0,Math.min(6000,distancePoints+timePoints));
}
function distanceLabel(km:number){
  const miles=km*.621371;
  if(miles<.1)return Math.round(miles*5280).toLocaleString()+' ft';
  return miles<10?miles.toFixed(2)+' mi':Math.round(miles)+' mi';
}
function timeLabel(seconds:number){
  const minutes=Math.floor(seconds/60),rest=seconds%60;
  return minutes?minutes+'m '+String(rest).padStart(2,'0')+'s':rest+'s';
}

export default function SponsoredMissionPage(){
  const[mission,setMission]=useState<MissionPayload|null>(null);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');
  const[guess,setGuess]=useState<LatLng|null>(null);
  const[revealed,setRevealed]=useState(false);
  const[distance,setDistance]=useState<number|null>(null);
  const[score,setScore]=useState<number|null>(null);
  const[startedAt,setStartedAt]=useState<number>(Date.now());
  const[elapsed,setElapsed]=useState(0);
  const[mapOpen,setMapOpen]=useState(false);

  useEffect(()=>{
    let alive=true;
    fetch('/api/missions/current',{cache:'no-store'})
      .then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Could not load Sponsored Mission.');return body;})
      .then(body=>{if(!alive)return;setMission(body.mission||null);setError(body.mission?'':body.error||'No Sponsored Mission is active right now.');setStartedAt(Date.now());})
      .catch(cause=>{if(alive)setError(cause instanceof Error?cause.message:'Could not load Sponsored Mission.');})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[]);

  useEffect(()=>{
    if(!mission||revealed)return;
    const key='geoweedo-mission-impression:'+mission.campaignId;
    if(sessionStorage.getItem(key))return;
    sessionStorage.setItem(key,'1');
    void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId:mission.campaignId,eventType:'game_impression',metadata:{surface:'sponsored_mission',path:'/missions'}})}).catch(()=>{});
  },[mission,revealed]);

  useEffect(()=>{
    if(revealed)return;
    const timer=window.setInterval(()=>setElapsed(Math.max(0,Math.floor((Date.now()-startedAt)/1000))),1000);
    return()=>window.clearInterval(timer);
  },[revealed,startedAt]);

  const actual=useMemo(()=>mission?{lat:mission.target.lat,lng:mission.target.lng}:null,[mission]);

  function reveal(){
    if(!mission||!guess||!actual)return;
    const seconds=Math.max(1,Math.floor((Date.now()-startedAt)/1000));
    const km=distanceKm(guess,actual);
    setElapsed(seconds);
    setDistance(km);
    setScore(missionScore(km,seconds));
    setRevealed(true);
    setMapOpen(true);
    const key='geoweedo-mission-complete:'+mission.campaignId;
    if(!sessionStorage.getItem(key)){
      sessionStorage.setItem(key,'1');
      void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId:mission.campaignId,eventType:'game_completed',metadata:{surface:'sponsored_mission',distanceKm:Number(km.toFixed(3)),elapsedSeconds:seconds}})}).catch(()=>{});
    }
  }

  function sponsorEvent(eventType:'listing_view'|'website_click'){
    if(!mission)return;
    void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId:mission.campaignId,eventType:eventType,metadata:{surface:'mission_reveal',path:'/missions'}})}).catch(()=>{});
  }

  function restart(){
    setGuess(null);setRevealed(false);setDistance(null);setScore(null);setElapsed(0);setMapOpen(false);setStartedAt(Date.now());
  }

  if(loading)return <main className={styles.shell}><SiteHeader/><section className={styles.empty}><strong>Loading Sponsored Mission…</strong></section></main>;
  if(!mission)return <main className={styles.shell}><SiteHeader/><section className={styles.empty}><div className={styles.kicker}>⭐ SPONSORED MISSIONS</div><h1>No mission is live right now.</h1><p>{error||'Check back for the next dispensary-sponsored challenge.'}</p><a href="/">Back to GeoWeedo →</a></section></main>;

  return <main className={styles.shell}>
    <SiteHeader/>
    <header className={styles.gameHeader}>
      <a href="/" className={styles.brand}>← GeoWeedo</a>
      <div><span>⭐ SPONSORED MISSION</span><strong>{revealed?mission.reveal.name:'Mystery dispensary'}</strong></div>
      <div className={styles.timer}>{timeLabel(elapsed)}</div>
    </header>

    <section className={styles.stage}>
      <div className={styles.street}>
        <StreetViewStage latitude={mission.start.lat} longitude={mission.start.lng}/>
        {!revealed?<div className={styles.missionBrief}>
          <span>MISSION</span>
          <strong>Find the sponsoring dispensary.</strong>
          <p>You started about {mission.start.approxDistanceKm.toFixed(1)} km from the target. Explore the streets, use landmarks and signs, then place your guess.</p>
        </div>:null}
      </div>

      <button type="button" className={styles.mobileMapToggle} onClick={()=>setMapOpen(value=>!value)}>{mapOpen?'Hide guess map':guess?'Guess map · pin placed':'Open guess map'}</button>

      <aside className={styles.guessPanel+(mapOpen?' '+styles.open:'')}>
        <div className={styles.map}>
          <GuessMap guess={guess} actual={actual} revealed={revealed} onGuess={setGuess}/>
        </div>
        {!revealed?<div className={styles.guessActions}>
          <span>{guess?'Pin placed — move it until you are ready.':'Place a pin where you think the dispensary is.'}</span>
          <button type="button" disabled={!guess} onClick={reveal}>{guess?'Lock in mission guess':'Place a pin first'}</button>
        </div>:<div className={styles.reveal}>
          <div className={styles.revealTop}>
            {mission.reveal.logo?<img src={mission.reveal.logo} alt=""/>:<div className={styles.logoFallback}>★</div>}
            <div><span>MISSION TARGET REVEALED</span><h1>{mission.reveal.name}</h1><p>{[mission.reveal.city,mission.reveal.region].filter(Boolean).join(', ')}</p></div>
          </div>
          <div className={styles.stats}>
            <div><span>Score</span><strong>{Number(score||0).toLocaleString()} <small>/ 6,000</small></strong></div>
            <div><span>Distance</span><strong>{distance===null?'—':distanceLabel(distance)}</strong></div>
            <div><span>Time</span><strong>{timeLabel(elapsed)}</strong></div>
          </div>
          <p className={styles.thanks}>Sponsored Mission by {mission.reveal.name}. This business intentionally became the mission target; sponsorship does not affect Classic, Daily, or Hunt location odds.</p>
          <div className={styles.revealActions}>
            <a href={mission.reveal.profileHref} onClick={()=>sponsorEvent('listing_view')}>View dispensary →</a>
            {mission.reveal.website?<a href={mission.reveal.website} target="_blank" rel="noreferrer" onClick={()=>sponsorEvent('website_click')}>Website ↗</a>:null}
            <button type="button" onClick={restart}>Play mission again</button>
          </div>
        </div>}
      </aside>
    </section>
  </main>;
}
