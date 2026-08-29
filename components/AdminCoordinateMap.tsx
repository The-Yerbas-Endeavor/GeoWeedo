'use client';

import { useEffect, useRef } from 'react';
import { Map as LibreMap, Marker, NavigationControl, type StyleSpecification } from 'maplibre-gl';
import AdminNearbyImagePreview from '@/components/AdminNearbyImagePreview';

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

  return <>
    <div className="admin-coordinate-split">
      <div className="admin-coordinate-pane">
        <div className="admin-coordinate-pane-label">Coordinate map</div>
        <div className="admin-coordinate-map" ref={nodeRef} aria-label="Dispensary coordinate verification map" />
      </div>
      <div className="admin-coordinate-pane">
        <div className="admin-coordinate-pane-label">Street view image</div>
        <AdminNearbyImagePreview latitude={latitude} longitude={longitude}/>
      </div>
    </div>
    <style jsx global>{`
      .admin-coordinate-split{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px;background:#0b100d}
      .admin-coordinate-pane{min-width:0;border:1px solid #28362d;border-radius:9px;overflow:hidden;background:#101712}
      .admin-coordinate-pane-label{padding:8px 10px;border-bottom:1px solid #28362d;color:#dce9df;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
      .admin-coordinate-split .admin-coordinate-map{height:350px!important;width:100%}
      .admin-nearby-preview{height:350px;display:flex;flex-direction:column;background:#111713}
      .admin-nearby-preview img{width:100%;height:100%;min-height:0;object-fit:cover;display:block}
      .admin-nearby-preview-empty{flex:1;display:grid;place-items:center;padding:24px;text-align:center;color:#94a69a;font-size:12px}
      .admin-nearby-preview-meta{display:flex;justify-content:space-between;gap:12px;padding:9px 10px;border-top:1px solid #28362d;color:#8fa297;font-size:10px}
      .admin-nearby-preview-meta strong{color:#c6d5ca;font-weight:700}
      @media(max-width:1250px){.admin-coordinate-split{grid-template-columns:1fr}.admin-coordinate-split .admin-coordinate-map,.admin-nearby-preview{height:320px!important}}
      @media(max-width:760px){.admin-coordinate-split .admin-coordinate-map,.admin-nearby-preview{height:280px!important}}
    `}</style>
  </>;
}
