'use client';

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/googleMaps';

type Props = {
  latitude: number;
  longitude: number;
  heading?: number;
};

export default function StreetViewStage({ latitude, longitude, heading = 0 }: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let panorama: any;
    let cancelled = false;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !nodeRef.current) return;
        panorama = new google.maps.StreetViewPanorama(nodeRef.current, {
          position: { lat: latitude, lng: longitude },
          pov: { heading, pitch: 0 },
          zoom: 1,
          addressControl: false,
          fullscreenControl: false,
          motionTracking: false,
          motionTrackingControl: false,
          showRoadLabels: false,
          linksControl: true,
          panControl: true,
          zoomControl: true,
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Street View failed to load.');
      });

    return () => {
      cancelled = true;
      panorama = null;
    };
  }, [latitude, longitude, heading]);

  return (
    <div className="streetview-wrap">
      <div ref={nodeRef} className="streetview-canvas" aria-label="Interactive Street View panorama" />
      {error && (
        <div className="map-error">
          <strong>Street View unavailable</strong>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
