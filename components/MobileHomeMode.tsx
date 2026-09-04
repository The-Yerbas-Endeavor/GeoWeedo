'use client';

import { useEffect, useState } from 'react';
import { trackAnalyticsEvent } from '@/components/AnalyticsTracker';

type HomeMode = 'choose' | 'search' | 'play';
type SelectedDispensary={id:string;name:string}|null;

export default function MobileHomeMode() {
  const [mode, setMode] = useState<HomeMode>('choose');
  const [selectedDispensary,setSelectedDispensary]=useState<SelectedDispensary>(null);

  useEffect(() => {
    document.body.dataset.mobileHomeMode = mode;
    return () => { delete document.body.dataset.mobileHomeMode; };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'search') return;
    const timer = window.setTimeout(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.map-browser-tools button'));
      const listButton = buttons.find((button) => /^List\b/i.test(button.textContent?.trim() || ''));
      if (listButton) listButton.click();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mode]);

  useEffect(()=>{
    if(mode!=='search'){setSelectedDispensary(null);return;}
    const sync=()=>{
      const card=document.querySelector<HTMLElement>('.map-first-home .map-location-card[data-location-id]');
      const id=card?.dataset.locationId?.trim()||'';
      const name=card?.querySelector('h3')?.textContent?.trim()||'';
      setSelectedDispensary(id?{id,name:name||'Dispensary'}:null);
    };
    sync();
    const observer=new MutationObserver(sync);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-location-id']});
    return()=>observer.disconnect();
  },[mode]);

  const choose=(next:HomeMode)=>{
    if(next==='search')trackAnalyticsEvent('home_search_selected',{surface:'mobile_choice'});
    if(next==='play')trackAnalyticsEvent('home_play_selected',{surface:'mobile_choice'});
    setMode(next);
  };

  return (
    <div className="mobile-home-mode-ui" aria-live="polite">
      {mode === 'choose' ? (
        <section className="mobile-home-choice" aria-label="Choose GeoWeedo mode">
          <div className="mobile-home-brand">
            <img src="/assets/geoweedo/geoweedo-mascot.png" alt="GeoWeedo mascot" className="mobile-home-mascot" />
            <div className="mobile-home-wordmark"><span>Geo</span><strong>Weedo</strong></div>
          </div>
          <div className="mobile-home-tagline">WEEDO SEARCH. WEEDO FIND. WEEDO PLAY.</div>
          <p>What would you like to do?</p>
          <div className="mobile-home-choice-actions">
            <button type="button" className="mobile-home-search" onClick={() => choose('search')}>Search GeoWeedo</button>
            <button type="button" className="mobile-home-play" onClick={() => choose('play')}>Play GeoWeedo</button>
          </div>
        </section>
      ) : (
        <>
          <button type="button" className="mobile-home-mode-back" onClick={() => choose('choose')}>‹ Search or Play</button>
          {mode==='search'&&selectedDispensary&&(
            <a className="mobile-selected-dispensary-info" href={`/dispensary/${encodeURIComponent(selectedDispensary.id)}`} title={`Open ${selectedDispensary.name} profile`}>
              Info · {selectedDispensary.name}
            </a>
          )}
        </>
      )}
    </div>
  );
}
