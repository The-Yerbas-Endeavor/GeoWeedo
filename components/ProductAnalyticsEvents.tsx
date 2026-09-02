'use client';

import { useEffect } from 'react';
import { trackAnalyticsEvent } from '@/components/AnalyticsTracker';

export default function ProductAnalyticsEvents(){
 useEffect(()=>{
  const onClick=(event:MouseEvent)=>{
   const target=event.target as Element|null;
   const button=target?.closest('button,a') as HTMLElement|null;
   if(!button)return;
   const text=(button.textContent||'').trim();
   if(button.matches('.home-play-button'))trackAnalyticsEvent('game_started',{surface:'home_card'});
   else if(button.matches('.map-browser-row'))trackAnalyticsEvent('dispensary_detail_open',{name:button.querySelector('strong')?.textContent?.trim()||''});
   else if(button.matches('.map-location-focus'))trackAnalyticsEvent('streetview_opened',{surface:'map_location_card'});
   else if(button.matches('.mobile-guess-toggle'))trackAnalyticsEvent('guess_map_toggled',{open:button.getAttribute('aria-expanded')!=='true'});
   else if(/^Make Guess$/i.test(text))trackAnalyticsEvent('guess_submitted');
   else if(/^Next Round$/i.test(text))trackAnalyticsEvent('game_round_advanced');
   else if(/^See Results$/i.test(text))trackAnalyticsEvent('game_completed');
   else if(/^Play Again$/i.test(text))trackAnalyticsEvent('game_replayed');
   else if(/^Go to Account$/i.test(text))trackAnalyticsEvent('game_account_cta');
  };
  document.addEventListener('click',onClick,true);
  return()=>document.removeEventListener('click',onClick,true);
 },[]);
 return null;
}
