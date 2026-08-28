'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';

type Props = {
  latitude: number;
  longitude: number;
  heading?: number;
  photoId?: string;
  imageryProvider?: 'kartaview' | 'geoweedo';
  imageUrl?: string;
  projection?: string;
  fieldOfView?: number;
};

type StreetPhoto = {
  id: string; lat: number; lng: number; heading: number; fieldOfView: number; projection: string;
  imageUrl: string; sequenceId: string; sequenceIndex: number; shotDate?: string | null;
};

type ApiResponse = { provider?: string; photos?: StreetPhoto[]; initialIndex?: number; attribution?: string; message?: string; error?: string };

export default function StreetViewStage({ latitude, longitude, heading = 0, photoId, imageryProvider = 'kartaview', imageUrl, projection = '', fieldOfView = 0 }: Props) {
  const sphereRef = useRef<HTMLDivElement | null>(null);
  const flatStageRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const [photos, setPhotos] = useState<StreetPhoto[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flatZoom, setFlatZoom] = useState(1);
  const [flatOffset, setFlatOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setError(null); setIndex(0);
    if (imageryProvider === 'geoweedo') {
      if (!imageUrl) { setPhotos([]); setError('The approved GeoWeedo-hosted image is missing.'); setLoading(false); return; }
      setPhotos([{ id: photoId || 'geoweedo-hosted', lat: latitude, lng: longitude, heading, fieldOfView, projection: projection.toUpperCase(), imageUrl, sequenceId: 'geoweedo', sequenceIndex: 0 }]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true); setPhotos([]);
    const query = new URLSearchParams({ lat: String(latitude), lng: String(longitude) });
    if (photoId) query.set('photoId', photoId);
    fetch(`/api/street-imagery?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => { const data = (await response.json()) as ApiResponse; if (!response.ok) throw new Error(data.error || 'Street imagery lookup failed.'); return data; })
      .then((data) => {
        const nextPhotos = data.photos ?? [];
        setPhotos(nextPhotos);
        setIndex(Math.min(Math.max(data.initialIndex ?? 0, 0), Math.max(0, nextPhotos.length - 1)));
        if (!nextPhotos.length) setError(data.message || 'No KartaView imagery is available near this round yet.');
      })
      .catch((err) => { if (err?.name !== 'AbortError') setError(err instanceof Error ? err.message : 'Street imagery failed to load.'); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [latitude, longitude, heading, photoId, imageryProvider, imageUrl, projection, fieldOfView]);

  const current = photos[index];
  const isSphere = useMemo(() => Boolean(current && (current.projection === 'SPHERE' || current.projection === 'EQUIRECTANGULAR' || current.fieldOfView >= 300)), [current]);

  useEffect(() => {
    setFlatZoom(1);
    setFlatOffset({ x: 0, y: 0 });
    dragRef.current = null;
  }, [current?.id]);

  useEffect(() => {
    const container = sphereRef.current;
    viewerRef.current?.destroy();
    viewerRef.current = null;
    if (!current || !isSphere || !container) return;

    const viewer = new Viewer({
      container,
      panorama: current.imageUrl,
      navbar: ['zoom', 'move', 'caption', 'fullscreen'],
      caption: imageryProvider === 'geoweedo' ? 'GeoWeedo hosted panorama' : 'KartaView street imagery',
      defaultYaw: ((current.heading || 0) * Math.PI) / 180,
      mousemove: true,
      mousewheel: true,
      mousewheelCtrlKey: false,
      touchmoveTwoFingers: false,
      keyboard: 'always',
      moveInertia: 0.9,
      moveSpeed: 1.4,
    });

    viewer.setCursor('grab');
    viewerRef.current = viewer;

    return () => {
      if (viewerRef.current === viewer) viewerRef.current = null;
      viewer.destroy();
    };
  }, [current, isSphere, imageryProvider]);

  const step = (direction: -1 | 1) => setIndex((value) => Math.min(Math.max(value + direction, 0), Math.max(0, photos.length - 1)));
  const providerLabel = imageryProvider === 'geoweedo' ? 'GeoWeedo hosted' : 'KartaView';
  const setZoom = (next: number) => {
    const clamped = Math.min(3.5, Math.max(1, next));
    setFlatZoom(clamped);
    if (clamped === 1) setFlatOffset({ x: 0, y: 0 });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT|BUTTON/.test(target.tagName)) return;
      const key = event.key.toLowerCase();

      if (key === 'arrowleft' || key === 'a') {
        if (isSphere) viewerRef.current?.rotate({ yaw: '-=0.12', pitch: 0 });
        else step(-1);
        event.preventDefault();
      }
      if (key === 'arrowright' || key === 'd') {
        if (isSphere) viewerRef.current?.rotate({ yaw: '+=0.12', pitch: 0 });
        else step(1);
        event.preventDefault();
      }
      if (key === 'arrowup' || key === 'w') {
        if (isSphere) viewerRef.current?.rotate({ yaw: 0, pitch: '+=0.10' });
        else step(1);
        event.preventDefault();
      }
      if (key === 'arrowdown' || key === 's') {
        if (isSphere) viewerRef.current?.rotate({ yaw: 0, pitch: '-=0.10' });
        else step(-1);
        event.preventDefault();
      }
      if (key === '+' || key === '=') {
        if (isSphere) viewerRef.current?.zoom((viewerRef.current.getZoomLevel() ?? 50) + 10);
        else setZoom(flatZoom + 0.25);
      }
      if (key === '-' || key === '_') {
        if (isSphere) viewerRef.current?.zoom((viewerRef.current.getZoomLevel() ?? 50) - 10);
        else setZoom(flatZoom - 0.25);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSphere, photos.length, flatZoom]);

  const onFlatWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom(flatZoom + (event.deltaY < 0 ? 0.2 : -0.2));
  };

  const onFlatPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (flatZoom <= 1) return;
    flatStageRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: flatOffset.x, y: flatOffset.y, startX: event.clientX, startY: event.clientY };
  };

  const onFlatPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setFlatOffset({ x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY });
  };

  const endFlatDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    try { flatStageRef.current?.releasePointerCapture(event.pointerId); } catch {}
  };

  return (
    <div className={`streetview-wrap ${isSphere ? 'streetview-spherical' : 'streetview-sequence'}`}>
      {loading && <div className="map-error"><strong>Loading street imagery…</strong><span>Loading the approved starting frame.</span></div>}
      {!loading && current && <>
        {isSphere ? (
          <>
            <div ref={sphereRef} className="streetview-canvas interactive-sphere" tabIndex={0} aria-label={`Interactive ${providerLabel} 360 panorama`} />
            <div className="street-drag-hint">Drag to look around · wheel/pinch to zoom · WASD/arrows to look</div>
          </>
        ) : (
          <div
            ref={flatStageRef}
            className={`street-photo-stage ${flatZoom > 1 ? 'is-zoomed' : ''}`}
            tabIndex={0}
            onWheel={onFlatWheel}
            onPointerDown={onFlatPointerDown}
            onPointerMove={onFlatPointerMove}
            onPointerUp={endFlatDrag}
            onPointerCancel={endFlatDrag}
            onDoubleClick={() => setZoom(flatZoom > 1 ? 1 : 2)}
            aria-label={`Interactive ${providerLabel} street-level sequence`}
          >
            <img
              src={current.imageUrl}
              alt={`${providerLabel} street-level imagery near the round location`}
              draggable={false}
              style={{ transform: `translate(${flatOffset.x}px, ${flatOffset.y}px) scale(${flatZoom})` }}
            />
            <button type="button" className="street-nav street-nav-prev" onClick={() => step(-1)} disabled={index <= 0} aria-label="Move backward">‹</button>
            <button type="button" className="street-nav street-nav-next" onClick={() => step(1)} disabled={index >= photos.length - 1} aria-label="Move forward">›</button>
            <div className="street-zoom-controls" aria-label="Street image zoom controls">
              <button type="button" onClick={() => setZoom(flatZoom - 0.25)} disabled={flatZoom <= 1}>−</button>
              <button type="button" onClick={() => setZoom(1)} disabled={flatZoom === 1}>Reset</button>
              <button type="button" onClick={() => setZoom(flatZoom + 0.25)} disabled={flatZoom >= 3.5}>+</button>
            </div>
            <div className="street-drag-hint">A/D or W/S to move · wheel/double-click to zoom · drag when zoomed</div>
          </div>
        )}
        <div className="street-imagery-toolbar">
          <button type="button" onClick={() => step(-1)} disabled={index <= 0}>← Previous</button>
          <span>{index + 1} / {photos.length} · {providerLabel}{isSphere ? ' · 360°' : ' · sequence'}</span>
          <button type="button" onClick={() => step(1)} disabled={index >= photos.length - 1}>Next →</button>
        </div>
      </>}
      {!loading && error && <div className="map-error"><strong>Street imagery unavailable</strong><span>{error}</span><span className="imagery-note">This round needs curated KartaView or GeoWeedo-hosted imagery before it should enter the live pool.</span></div>}
    </div>
  );
}
