'use client';

import { useEffect, useState } from 'react';
import SiteHeader from '@/components/SiteHeader';
import StreetViewStage from '@/components/StreetViewStage';
import GuessMap, { type LatLng } from '@/components/GuessMap';
import styles from './mission.module.css';

type MissionPayload={
  campaignId:string;
  startsAt:string;
  endsAt:string;
  missionDay:string;
  difficulty:'Easy'|'Medium'|'Hard';
  start:{lat:number;lng:number;approxDistanceKm:number};
};

type MissionResult={
  target:{lat:number;lng:number};
  distanceKm:number;
  score:number;
  elapsedSeconds:number;
  campaignTitle:string;
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
  const[result,setResult]=useState<MissionResult|null>(null);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState('');
  const[submitError,setSubmitError]=useState('');
  const[submitting,setSubmitting]=useState(false);
  const[guess,setGuess]=useState<LatLng|null>(null);
  const[revealed,setRevealed]=useState(false);
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
    void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId:mission.campaignId,eventType:'game_impression',metadata:{surface:'sponsored_mission',path:'/missions',missionDay:mission.missionDay,difficulty:mission.difficulty}})}).catch(()=>{});
  },[mission,revealed]);

  useEffect(()=>{
    if(revealed)return;
    const timer=window.setInterval(()=>setElapsed(Math.max(0,Math.floor((Date.now()-startedAt)/1000))),1000);
    return()=>window.clearInterval(timer);
  },[revealed,startedAt]);

  async function reveal(){
    if(!mission||!guess||submitting)return;
    setSubmitting(true);
    setSubmitError('');
    const seconds=Math.max(1,Math.floor((Date.now()-startedAt)/1000));
    try{
      const response=await fetch('/api/missions/guess',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({campaignId:mission.campaignId,guess,elapsedSeconds:seconds}),
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Could not score this mission guess.');
      const next=body.result as MissionResult;
      setResult(next);
      setElapsed(next.elapsedSeconds);
      setRevealed(true);
      setMapOpen(true);

      const key='geoweedo-mission-complete:'+mission.campaignId;
      if(!sessionStorage.getItem(key)){
        sessionStorage.setItem(key,'1');
        void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId:mission.campaignId,eventType:'game_completed',metadata:{surface:'sponsored_mission',distanceKm:Number(next.distanceKm.toFixed(3)),elapsedSeconds:next.elapsedSeconds,score:next.score,missionDay:mission.missionDay,difficulty:mission.difficulty}})}).catch(()=>{});
      }
    }catch(cause){
      setSubmitError(cause instanceof Error?cause.message:'Could not score this mission guess.');
    }finally{
      setSubmitting(false);
    }
  }

  function sponsorEvent(eventType:'listing_view'|'website_click'){
    if(!mission||!result)return;
    void fetch('/api/sponsorship/campaign',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({campaignId:mission.campaignId,eventType,metadata:{surface:'mission_reveal',path:'/missions',missionDay:mission.missionDay}})}).catch(()=>{});
  }

  function restart(){
    setGuess(null);setResult(null);setRevealed(false);setSubmitError('');setElapsed(0);setMapOpen(false);setStartedAt(Date.now());
  }

  if(loading)return <main className={styles.shell}><SiteHeader/><section className={styles.empty}><strong>Loading Sponsored Mission…</strong></section></main>;
  if(!mission)return <main className={styles.shell}><SiteHeader/><section className={styles.empty}><div className={styles.kicker}>⭐ SPONSORED MISSIONS</div><h1>No mission is live right now.</h1><p>{error||'Check back for the next dispensary-sponsored challenge.'}</p><a href="/">Back to GeoWeedo →</a></section></main>;

  return <main className={styles.shell}>
    <SiteHeader/>
    <header className={styles.gameHeader}>
      <a href="/" className={styles.brand}>← GeoWeedo</a>
      <div><span>⭐ SPONSORED MISSION</span><strong>{revealed&&result?result.reveal.name:'Mystery dispensary'}</strong></div>
      <div className={styles.timer}>{timeLabel(elapsed)}</div>
    </header>

    <section className={styles.stage}>
      <div className={styles.street}>
        <StreetViewStage latitude={mission.start.lat} longitude={mission.start.lng}/>
        {!revealed?<div className={styles.missionBrief}>
          <span>MISSION</span>
          <strong>Find the sponsoring dispensary.</strong>
          <div className={styles.missionMeta}><b>{mission.difficulty}</b><i>Daily route</i><i>{distanceLabel(mission.start.approxDistanceKm)} from target</i></div>
          <p>Explore the streets, use landmarks and signs, then place your guess. The sponsor identity and target coordinates stay hidden until you lock it in.</p>
        </div>:null}
      </div>

      <button type="button" className={styles.mobileMapToggle} onClick={()=>setMapOpen(value=>!value)}>{mapOpen?'Hide guess map':guess?'Guess map · pin placed':'Open guess map'}</button>

      <aside className={styles.guessPanel+(mapOpen?' '+styles.open:'')}>
        <div className={styles.map}>
          <GuessMap guess={guess} actual={result?.target||null} revealed={revealed} onGuess={setGuess}/>
        </div>
        {!revealed?<div className={styles.guessActions}>
          <span>{guess?'Pin placed — move it until you are ready.':'Place a pin where you think the dispensary is.'}</span>
          {submitError?<span className={styles.guessError}>{submitError}</span>:null}
          <button type="button" disabled={!guess||submitting} onClick={reveal}>{submitting?'Scoring mission…':guess?'Lock in mission guess':'Place a pin first'}</button>
        </div>:result?<div className={styles.reveal}>
          <div className={styles.revealTop}>
            {result.reveal.logo?<img src={result.reveal.logo} alt=""/>:<div className={styles.logoFallback}>★</div>}
            <div><span>MISSION TARGET REVEALED</span><h1>{result.reveal.name}</h1><p>{[result.reveal.city,result.reveal.region].filter(Boolean).join(', ')}</p></div>
          </div>
          <div className={styles.stats}>
            <div><span>Score</span><strong>{Number(result.score||0).toLocaleString()} <small>/ 6,000</small></strong></div>
            <div><span>Distance</span><strong>{distanceLabel(result.distanceKm)}</strong></div>
            <div><span>Time</span><strong>{timeLabel(result.elapsedSeconds)}</strong></div>
          </div>
          <p className={styles.thanks}>Sponsored Mission by {result.reveal.name}. Today’s starting route is shared for the mission day and changes on the next UTC day. Sponsorship does not affect Classic, Daily, or Hunt location odds.</p>
          <div className={styles.revealActions}>
            <a href={result.reveal.profileHref} onClick={()=>sponsorEvent('listing_view')}>View dispensary →</a>
            {result.reveal.website?<a href={result.reveal.website} target="_blank" rel="noreferrer" onClick={()=>sponsorEvent('website_click')}>Website ↗</a>:null}
            <button type="button" onClick={restart}>Practice again</button>
          </div>
        </div>:null}
      </aside>
    </section>
  </main>;
}
