'use client';

import { useEffect, useRef } from 'react';
import { Map as LibreMap, Marker, NavigationControl, type StyleSpecification } from 'maplibre-gl';

type Props = {
  latitude: number;
  longitude: number;
  onChange: (latitude: number, longitude: number) => void;
};

const STYLE: StyleSpecification = {
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
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export default function AdminCoordinateMap({ latitude, longitude, onChange }: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!nodeRef.current || mapRef.current || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const map = new LibreMap({
      container: nodeRef.current,
      style: STYLE,
      center: [longitude, latitude],
      zoom: 16,
      minZoom: 2,
      maxZoom: 19,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: {},
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    const marker = new Marker({ color: '#67d66e', draggable: true })
      .setLngLat([longitude, latitude])
      .addTo(map);
    markerRef.current = marker;

    marker.on('dragend', () => {
      const point = marker.getLngLat();
      onChangeRef.current(point.lat, point.lng);
    });
    map.on('click', (event) => {
      marker.setLngLat(event.lngLat);
      onChangeRef.current(event.lngLat.lat, event.lngLat.lng);
    });

    const resizeTimer = window.setTimeout(() => map.resize(), 120);
    return () => {
      window.clearTimeout(resizeTimer);
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    markerRef.current?.setLngLat([longitude, latitude]);
    mapRef.current?.easeTo({ center: [longitude, latitude], duration: 250 });
  }, [latitude, longitude]);

  return <div className="admin-coordinate-map" ref={nodeRef} aria-label="Dispensary coordinate verification map" />;
}
