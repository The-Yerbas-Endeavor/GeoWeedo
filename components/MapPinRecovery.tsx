'use client';

import { useEffect } from 'react';

function nudgeMap() {
  window.dispatchEvent(new Event('resize'));
}

export default function MapPinRecovery() {
  useEffect(() => {
    let timers: number[] = [];
    let scheduled = false;

    const scheduleRecovery = () => {
      if (scheduled) return;
      const homeMap = document.querySelector('.home-map-canvas .guess-map-wrap');
      if (!homeMap) return;

      scheduled = true;
      const delays = [80, 350, 900, 1800];
      timers.push(...delays.map((delay) => window.setTimeout(() => {
        nudgeMap();
        if (delay === delays[delays.length - 1]) scheduled = false;
      }, delay)));
    };

    const check = () => {
      const homeMap = document.querySelector('.home-map-canvas .guess-map-wrap');
      if (!homeMap) return;
      const status = homeMap.querySelector('.map-data-status')?.textContent || '';
      const mappedMatch = status.match(/([\d,]+)\s+mapped/i);
      const mapped = mappedMatch ? Number(mappedMatch[1].replace(/,/g, '')) : 0;
      const markerCount = homeMap.querySelectorAll('.maplibregl-marker').length;
      if (mapped > 0 && markerCount === 0) scheduleRecovery();
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        scheduled = false;
        scheduleRecovery();
      }
    };
    const onPageShow = () => {
      scheduled = false;
      scheduleRecovery();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    check();

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
    };
  }, []);

  return null;
}
