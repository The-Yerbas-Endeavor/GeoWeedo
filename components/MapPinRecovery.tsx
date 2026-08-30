'use client';

import { useEffect } from 'react';

function forceMapSync(homeMap: Element) {
  window.dispatchEvent(new Event('resize'));

  const zoomIn = homeMap.querySelector<HTMLButtonElement>('.maplibregl-ctrl-zoom-in');
  const zoomOut = homeMap.querySelector<HTMLButtonElement>('.maplibregl-ctrl-zoom-out');
  if (!zoomIn || !zoomOut) return;

  zoomIn.click();
  window.setTimeout(() => zoomOut.click(), 140);
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
      const delays = [120, 700, 1600];
      timers.push(...delays.map((delay) => window.setTimeout(() => {
        const currentMap = document.querySelector('.home-map-canvas .guess-map-wrap');
        if (!currentMap) return;

        const status = currentMap.querySelector('.map-data-status')?.textContent || '';
        const mappedMatch = status.match(/([\d,]+)\s+mapped/i);
        const mapped = mappedMatch ? Number(mappedMatch[1].replace(/,/g, '')) : 0;
        const markerCount = currentMap.querySelectorAll('.maplibregl-marker').length;

        if (mapped > 0 && markerCount === 0) forceMapSync(currentMap);
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
