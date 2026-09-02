'use client';

import { useEffect, useState } from 'react';
import { trackAnalyticsEvent } from '@/components/AnalyticsTracker';

type HomeMode = 'choose' | 'search' | 'play';

export default function MobileHomeMode() {
  const [mode, setMode] = useState<HomeMode>('choose');

  useEffect(() => {
    document.body.dataset.mobileHomeMode = mode;
    return () => {
      delete document.body.dataset.mobileHomeMode;
    };
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

  const choose=(next:HomeMode)=>{
    if(next==='search')trackAnalyticsEvent('home_search_selected',{surface:'mobile_choice'});
    if(next==='play')trackAnalyticsEvent('home_play_selected',{surface:'mobile_choice'});
    setMode(next);
  };

  return (
    <div className="mobile-home-mode-ui" aria-live="polite">
      {mode === 'choose' ? (
        <section className="mobile-home-choice" aria-label="Choose GeoWeedo mode">
          <div className="mobile-home-choice-mark" aria-hidden="true">✦</div>
          <h1>GeoWeedo</h1>
          <p>What would you like to do?</p>
          <div className="mobile-home-choice-actions">
            <button type="button" className="mobile-home-search" onClick={() => choose('search')}>
              Search GeoWeedo
            </button>
            <button type="button" className="mobile-home-play" onClick={() => choose('play')}>
              Play GeoWeedo
            </button>
          </div>
        </section>
      ) : (
        <button type="button" className="mobile-home-mode-back" onClick={() => choose('choose')}>
          ‹ Search or Play
        </button>
      )}
    </div>
  );
}
