'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl, { LngLatBounds } from 'maplibre-gl';

export type LatLng = { lat: number; lng: number };

type Props = {
  guess: LatLng | null;
  actual?: LatLng | null;
  revealed?: boolean;
  onGuess: (guess: LatLng) => void;
};

export default function GuessMap({ guess, actual = null, revealed = false, onGuess }: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const guessMarkerRef = useRef<maplibregl.Marker | null>(null);
  const actualMarkerRef = useRef<maplibregl.Marker | null>(null);
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
    if (!nodeRef.current || mapRef.current) return;

    try {
      const map = new maplibregl.Map({
        container: nodeRef.current,
        style: 'https://tiles.openfreemap.org/styles/bright',
        center: [-98, 39],
        zoom: 2.6,
        attributionControl: true,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('click', (event) => {
        if (revealedRef.current) return;
        onGuessRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      });
      map.on('error', () => {
        setError('The open map tiles could not be loaded.');
      });

      mapRef.current = map;
    } catch {
      setError('The open map could not be initialized in this browser.');
    }

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    guessMarkerRef.current?.remove();
    guessMarkerRef.current = null;
    actualMarkerRef.current?.remove();
    actualMarkerRef.current = null;

    if (map.getLayer('guess-line')) map.removeLayer('guess-line');
    if (map.getSource('guess-line')) map.removeSource('guess-line');

    if (guess) {
      guessMarkerRef.current = new maplibregl.Marker({ color: '#67d66e' })
        .setLngLat([guess.lng, guess.lat])
        .setPopup(new maplibregl.Popup({ offset: 18 }).setText('Your guess'))
        .addTo(map);

      if (!revealed) map.easeTo({ center: [guess.lng, guess.lat], duration: 350 });
    }

    if (revealed && actual) {
      actualMarkerRef.current = new maplibregl.Marker({ color: '#f4f7f4' })
        .setLngLat([actual.lng, actual.lat])
        .setPopup(new maplibregl.Popup({ offset: 18 }).setText('Actual location'))
        .addTo(map);

      if (guess) {
        const line = {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [guess.lng, guess.lat],
              [actual.lng, actual.lat],
            ],
          },
        };

        const addLine = () => {
          if (map.getSource('guess-line')) return;
          map.addSource('guess-line', { type: 'geojson', data: line });
          map.addLayer({
            id: 'guess-line',
            type: 'line',
            source: 'guess-line',
            paint: {
              'line-color': '#67d66e',
              'line-width': 3,
              'line-opacity': 0.8,
            },
          });
        };

        if (map.isStyleLoaded()) addLine();
        else map.once('load', addLine);

        const bounds = new LngLatBounds();
        bounds.extend([guess.lng, guess.lat]);
        bounds.extend([actual.lng, actual.lat]);
        map.fitBounds(bounds, { padding: 56, maxZoom: 9, duration: 450 });
      } else {
        map.easeTo({ center: [actual.lng, actual.lat], zoom: 8, duration: 450 });
      }
    }
  }, [guess, actual, revealed]);

  return (
    <div className="guess-map-wrap">
      <div ref={nodeRef} className="guess-map-canvas" aria-label="Interactive open-source guessing map" />
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
