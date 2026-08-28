'use client';

import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '@/lib/googleMaps';

export type LatLng = { lat: number; lng: number };

type Props = {
  guess: LatLng | null;
  actual?: LatLng | null;
  revealed?: boolean;
  onGuess: (guess: LatLng) => void;
};

export default function GuessMap({ guess, actual = null, revealed = false, onGuess }: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const guessMarkerRef = useRef<any>(null);
  const actualMarkerRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const revealedRef = useRef(revealed);
  const onGuessRef = useRef(onGuess);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);

  useEffect(() => {
    onGuessRef.current = onGuess;
  }, [onGuess]);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !nodeRef.current || mapRef.current) return;

        const map = new google.maps.Map(nodeRef.current, {
          center: { lat: 39, lng: -98 },
          zoom: 3,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });

        map.addListener('click', (event: any) => {
          if (revealedRef.current || !event.latLng) return;
          onGuessRef.current({ lat: event.latLng.lat(), lng: event.latLng.lng() });
        });

        mapRef.current = map;
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Guessing map failed to load.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const google = (window as any).google;
    if (!map || !google?.maps) return;

    if (guessMarkerRef.current) {
      guessMarkerRef.current.setMap(null);
      guessMarkerRef.current = null;
    }
    if (actualMarkerRef.current) {
      actualMarkerRef.current.setMap(null);
      actualMarkerRef.current = null;
    }
    if (lineRef.current) {
      lineRef.current.setMap(null);
      lineRef.current = null;
    }

    if (guess) {
      guessMarkerRef.current = new google.maps.Marker({
        position: guess,
        map,
        title: 'Your guess',
        label: 'G',
      });
      if (!revealed) map.panTo(guess);
    }

    if (revealed && actual) {
      actualMarkerRef.current = new google.maps.Marker({
        position: actual,
        map,
        title: 'Actual location',
        label: 'A',
      });

      if (guess) {
        lineRef.current = new google.maps.Polyline({
          path: [guess, actual],
          geodesic: true,
          strokeOpacity: 0.8,
          strokeWeight: 3,
          map,
        });
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(guess);
        bounds.extend(actual);
        map.fitBounds(bounds, 56);
      } else {
        map.panTo(actual);
      }
    }
  }, [guess, actual, revealed]);

  return (
    <div className="guess-map-wrap">
      <div ref={nodeRef} className="guess-map-canvas" aria-label="Interactive guessing map" />
      {!guess && !revealed && !error && <div className="map-hint">Click anywhere on the map to place your guess</div>}
      {error && (
        <div className="map-error compact">
          <strong>Map unavailable</strong>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
