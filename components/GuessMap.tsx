'use client';

import { useEffect, useRef } from 'react';
import {
  LngLatBounds,
  Map as LibreMap,
  Marker,
  NavigationControl,
  Popup,
  type StyleSpecification,
} from 'maplibre-gl';

export type LatLng = { lat: number; lng: number };
export type MapLocation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  region?: string;
  sponsored?: boolean;
};

type Props = {
  guess: LatLng | null;
  actual?: LatLng | null;
  revealed?: boolean;
  onGuess: (guess: LatLng) => void;
  locations?: MapLocation[];
  browseMode?: boolean;
};

const GAME_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }],
};

export default function GuessMap({
  guess,
  actual = null,
  revealed = false,
  onGuess,
  locations = [],
  browseMode = false,
}: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const guessMarkerRef = useRef<Marker | null>(null);
  const actualMarkerRef = useRef<Marker | null>(null);
  const locationMarkersRef = useRef<Marker[]>([]);
  const revealedRef = useRef(revealed);
  const browseModeRef = useRef(browseMode);
  const onGuessRef = useRef(onGuess);

  useEffect(() => { revealedRef.current = revealed; }, [revealed]);
  useEffect(() => { browseModeRef.current = browseMode; }, [browseMode]);
  useEffect(() => { onGuessRef.current = onGuess; }, [onGuess]);

  useEffect(() => {
    if (!nodeRef.current || mapRef.current) return;

    try {
      const map = new LibreMap({
        container: nodeRef.current,
        style: GAME_STYLE,
        center: [-98, 39],
        zoom: 2.6,
        minZoom: 1,
        maxZoom: 19,
        attributionControl: {},
        dragRotate: false,
        pitchWithRotate: false,
        scrollZoom: true,
        dragPan: true,
        doubleClickZoom: true,
        keyboard: true,
        touchZoomRotate: true,
        boxZoom: true,
      });

      map.touchZoomRotate.disableRotation();
      map.addControl(new NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
      map.on('load', () => map.resize());
      map.on('click', (event) => {
        if (browseModeRef.current || revealedRef.current) return;
        onGuessRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      });
      map.on('error', (event) => {
        console.warn('GeoWeedo map resource warning:', event.error?.message || event);
      });

      mapRef.current = map;
      const resizeTimer = window.setTimeout(() => map.resize(), 250);
      return () => {
        window.clearTimeout(resizeTimer);
        locationMarkersRef.current.forEach((marker) => marker.remove());
        locationMarkersRef.current = [];
        map.remove();
        mapRef.current = null;
      };
    } catch (error) {
      console.error('GeoWeedo map initialization failed:', error);
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    locationMarkersRef.current.forEach((marker) => marker.remove());
    locationMarkersRef.current = [];
    if (!browseMode || locations.length === 0) return;

    const bounds = new LngLatBounds();
    for (const location of locations) {
      if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) continue;
      const subtitle = [location.city, location.region].filter(Boolean).join(', ');
      const popupText = subtitle ? `${location.name}\n${subtitle}` : location.name;
      const marker = new Marker({ color: location.sponsored ? '#f5c451' : '#67d66e' })
        .setLngLat([location.lng, location.lat])
        .setPopup(new Popup({ offset: 18 }).setText(popupText))
        .addTo(map);
      locationMarkersRef.current.push(marker);
      bounds.extend([location.lng, location.lat]);
    }

    if (!bounds.isEmpty()) {
      const fit = () => map.fitBounds(bounds, { padding: 80, maxZoom: 6, duration: 500 });
      if (map.isStyleLoaded()) fit(); else map.once('load', fit);
    }
  }, [browseMode, locations]);

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
      guessMarkerRef.current = new Marker({ color: '#67d66e' })
        .setLngLat([guess.lng, guess.lat])
        .setPopup(new Popup({ offset: 18 }).setText('Your guess'))
        .addTo(map);
    }

    if (revealed && actual) {
      actualMarkerRef.current = new Marker({ color: '#f4f7f4' })
        .setLngLat([actual.lng, actual.lat])
        .setPopup(new Popup({ offset: 18 }).setText('Actual location'))
        .addTo(map);

      if (guess) {
        const line = {
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'LineString' as const, coordinates: [[guess.lng, guess.lat], [actual.lng, actual.lat]] },
        };
        const addLine = () => {
          if (map.getSource('guess-line')) return;
          map.addSource('guess-line', { type: 'geojson', data: line });
          map.addLayer({ id: 'guess-line', type: 'line', source: 'guess-line', paint: { 'line-color': '#67d66e', 'line-width': 3, 'line-opacity': 0.8 } });
        };
        if (map.isStyleLoaded()) addLine(); else map.once('load', addLine);
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
      <div
        ref={nodeRef}
        className="guess-map-canvas"
        tabIndex={0}
        aria-label={browseMode ? 'GeoWeedo dispensary location map' : 'Interactive open-source guessing map'}
      />
      {browseMode
        ? <div className="map-hint">Drag to pan · scroll/pinch to zoom · click pins for details</div>
        : !revealed && <div className="map-hint">Drag to pan · scroll/pinch to zoom · click to place your guess</div>}
    </div>
  );
}
