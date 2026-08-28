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
  const viewerRef = useRef<Viewer | null>(null);
  const [photos, setPhotos] = useState<StreetPhoto[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      moveInertia: 0.8,
      moveSpeed: 1.25,
    });

    viewer.setCursor('grab');
    viewerRef.current = viewer;

    // PSV already owns pointer/touch gestures. Explicitly keep browser scrolling and
    // parent overlays from stealing drag gestures from the WebGL canvas.
    const stop = (event: Event) => event.stopPropagation();
    container.addEventListener('pointerdown', stop);
    container.addEventListener('pointermove', stop);
    container.addEventListener('touchstart', stop, { passive: true });
    container.addEventListener('touchmove', stop, { passive: true });

    return () => {
      container.removeEventListener('pointerdown', stop);
      container.removeEventListener('pointermove', stop);
      container.removeEventListener('touchstart', stop);
      container.removeEventListener('touchmove', stop);
      if (viewerRef.current === viewer) viewerRef.current = null;
      viewer.destroy();
    };
  }, [current, isSphere, imageryProvider]);

  const step = (direction: -1 | 1) => setIndex((value) => Math.min(Math.max(value + direction, 0), Math.max(0, photos.length - 1)));
  const providerLabel = imageryProvider === 'geoweedo' ? 'GeoWeedo hosted' : 'KartaView';

  useEffect(() => {
    if (isSphere) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') step(-1);
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSphere, photos.length]);

  return (
    <div className={`streetview-wrap ${isSphere ? 'streetview-spherical' : 'streetview-sequence'}`}>
      {loading && <div className="map-error"><strong>Loading street imagery…</strong><span>Loading the approved starting frame.</span></div>}
      {!loading && current && <>
        {isSphere ? (
          <>
            <div ref={sphereRef} className="streetview-canvas interactive-sphere" aria-label={`Interactive ${providerLabel} 360 panorama`} />
            <div className="street-drag-hint">Drag to look around · scroll to zoom · arrows also rotate</div>
          </>
        ) : (
          <div className="street-photo-stage">
            <img src={current.imageUrl} alt={`${providerLabel} street-level imagery near the round location`} draggable={false} />
            <button type="button" className="street-nav street-nav-prev" onClick={() => step(-1)} disabled={index <= 0} aria-label="Move backward">‹</button>
            <button type="button" className="street-nav street-nav-next" onClick={() => step(1)} disabled={index >= photos.length - 1} aria-label="Move forward">›</button>
            <div className="street-drag-hint">Move with ‹ › or keyboard A / D</div>
          </div>
        )}
        <div className="street-imagery-toolbar"><button type="button" onClick={() => step(-1)} disabled={index <= 0}>← Previous</button><span>{index + 1} / {photos.length} · {providerLabel}{isSphere ? ' · 360°' : ''}</span><button type="button" onClick={() => step(1)} disabled={index >= photos.length - 1}>Next →</button></div>
      </>}
      {!loading && error && <div className="map-error"><strong>Street imagery unavailable</strong><span>{error}</span><span className="imagery-note">This round needs curated KartaView or GeoWeedo-hosted imagery before it should enter the live pool.</span></div>}
    </div>
  );
}
