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
  const isSphere = useMemo(() => Boolean(current && (current.projection === 'SPHERE' || current.fieldOfView >= 300)), [current]);

  useEffect(() => {
    viewerRef.current?.destroy(); viewerRef.current = null;
    if (!current || !isSphere || !sphereRef.current) return;
    viewerRef.current = new Viewer({
      container: sphereRef.current,
      panorama: current.imageUrl,
      navbar: ['zoom', 'move', 'caption', 'fullscreen'],
      caption: imageryProvider === 'geoweedo' ? 'GeoWeedo hosted panorama' : 'KartaView street imagery',
      defaultYaw: ((current.heading || 0) * Math.PI) / 180,
      mousewheelCtrlKey: false,
      touchmoveTwoFingers: false,
    });
    return () => { viewerRef.current?.destroy(); viewerRef.current = null; };
  }, [current, isSphere, imageryProvider]);

  const step = (direction: -1 | 1) => setIndex((value) => Math.min(Math.max(value + direction, 0), Math.max(0, photos.length - 1)));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') step(-1);
      if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') step(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [photos.length]);

  const providerLabel = imageryProvider === 'geoweedo' ? 'GeoWeedo hosted' : 'KartaView';

  return (
    <div className="streetview-wrap">
      {loading && <div className="map-error"><strong>Loading street imagery…</strong><span>Loading the approved starting frame.</span></div>}
      {!loading && current && <>
        {isSphere ? (
          <div ref={sphereRef} className="streetview-canvas" aria-label={`Interactive ${providerLabel} 360 panorama`} />
        ) : (
          <div className="street-photo-stage" aria-label={`Interactive ${providerLabel} street sequence`}>
            <img src={current.imageUrl} alt={`${providerLabel} street-level imagery near the round location`} draggable={false} />
            {photos.length > 1 && <>
              <button type="button" className="street-nav street-nav-prev" aria-label="Move backward along street imagery" onClick={() => step(-1)} disabled={index <= 0}>‹</button>
              <button type="button" className="street-nav street-nav-next" aria-label="Move forward along street imagery" onClick={() => step(1)} disabled={index >= photos.length - 1}>›</button>
            </>}
            <div className="street-drag-hint">Use ← → or A / D to move along the street</div>
          </div>
        )}
        <div className="street-imagery-toolbar">
          <button type="button" onClick={() => step(-1)} disabled={index <= 0}>← Previous</button>
          <span>{index + 1} / {photos.length} · {providerLabel}{isSphere ? ' · drag to look around' : ' · street sequence'}</span>
          <button type="button" onClick={() => step(1)} disabled={index >= photos.length - 1}>Next →</button>
        </div>
      </>}
      {!loading && error && <div className="map-error"><strong>Street imagery unavailable</strong><span>{error}</span><span className="imagery-note">This round needs curated KartaView or GeoWeedo-hosted imagery before it should enter the live pool.</span></div>}
    </div>
  );
}
