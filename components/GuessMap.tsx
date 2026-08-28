'use client';

import { useEffect, useRef } from 'react';
import {
  LngLatBounds,
  Map as LibreMap,
  Marker,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type MapGeoJSONFeature,
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

const LOCATION_SOURCE = 'browse-locations';
const CLUSTER_LAYER = 'browse-clusters';
const CLUSTER_COUNT_LAYER = 'browse-cluster-count';
const POINT_LAYER = 'browse-points';

function featureCoordinates(feature: MapGeoJSONFeature): [number, number] | null {
  if (feature.geometry.type !== 'Point') return null;
  const coordinates = feature.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  return [Number(coordinates[0]), Number(coordinates[1])];
}

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
        map.remove();
        mapRef.current = null;
      };
    } catch (error) {
      console.error('GeoWeedo map initialization failed:', error);
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !browseMode) return;

    const applyLocations = () => {
      const features = locations
        .filter((location) => Number.isFinite(location.lat) && Number.isFinite(location.lng))
        .map((location) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [location.lng, location.lat] },
          properties: {
            id: location.id,
            name: location.name,
            city: location.city || '',
            region: location.region || '',
            sponsored: Boolean(location.sponsored),
          },
        }));

      const data = { type: 'FeatureCollection' as const, features };
      const existing = map.getSource(LOCATION_SOURCE) as GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
      } else {
        map.addSource(LOCATION_SOURCE, {
          type: 'geojson',
          data,
          cluster: true,
          clusterMaxZoom: 12,
          clusterRadius: 48,
        });
        map.addLayer({
          id: CLUSTER_LAYER,
          type: 'circle',
          source: LOCATION_SOURCE,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#2f8f46',
            'circle-radius': ['step', ['get', 'point_count'], 18, 25, 23, 100, 29, 500, 35],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#dff7e2',
          },
        });
        map.addLayer({
          id: CLUSTER_COUNT_LAYER,
          type: 'symbol',
          source: LOCATION_SOURCE,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 12,
          },
          paint: { 'text-color': '#ffffff' },
        });
        map.addLayer({
          id: POINT_LAYER,
          type: 'circle',
          source: LOCATION_SOURCE,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['case', ['boolean', ['get', 'sponsored'], false], '#f5c451', '#67d66e'],
            'circle-radius': 7,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#102114',
          },
        });

        map.on('click', CLUSTER_LAYER, async (event) => {
          const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
          const clusterId = Number(feature?.properties?.cluster_id);
          if (!feature || !Number.isFinite(clusterId)) return;
          const coordinates = featureCoordinates(feature);
          if (!coordinates) return;
          const source = map.getSource(LOCATION_SOURCE) as GeoJSONSource;
          const zoom = await source.getClusterExpansionZoom(clusterId);
          map.easeTo({ center: coordinates, zoom });
        });

        map.on('click', POINT_LAYER, (event) => {
          const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
          if (!feature) return;
          const coordinates = featureCoordinates(feature);
          if (!coordinates) return;
          const properties = feature.properties || {};
          const subtitle = [properties.city, properties.region].filter(Boolean).join(', ');
          const text = subtitle ? `${properties.name}\n${subtitle}` : String(properties.name || 'Dispensary');
          new Popup({ offset: 12 }).setLngLat(coordinates).setText(text).addTo(map);
        });

        for (const layer of [CLUSTER_LAYER, POINT_LAYER]) {
          map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
        }
      }

      if (features.length) {
        const bounds = new LngLatBounds();
        features.forEach((feature) => bounds.extend(feature.geometry.coordinates as [number, number]));
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 70, maxZoom: 5.5, duration: 500 });
      }
    };

    if (map.isStyleLoaded()) applyLocations(); else map.once('load', applyLocations);
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
        ? <div className="map-hint">Drag to pan · scroll/pinch to zoom · click clusters or locations</div>
        : !revealed && <div className="map-hint">Drag to pan · scroll/pinch to zoom · click to place your guess</div>}
    </div>
  );
}
