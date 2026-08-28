'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';

type Props = {
  latitude: number;
  longitude: number;
  heading?: number;
  photoId?: string;
};

type StreetPhoto = {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  fieldOfView: number;
  projection: string;
  imageUrl: string;
  sequenceId: string;
  sequenceIndex: number;
  shotDate?: string | null;
};

type ApiResponse = {
  provider?: string;
  photos?: StreetPhoto[];
  initialIndex?: number;
  attribution?: string;
  message?: string;
  error?: string;
};

export default function StreetViewStage({ latitude, longitude, photoId }: Props) {
  const sphereRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [photos, setPhotos] = useState<StreetPhoto[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPhotos([]);
    setIndex(0);

    const query = new URLSearchParams({ lat: String(latitude), lng: String(longitude) });
    if (photoId) query.set('photoId', photoId);

    fetch(`/api/street-imagery?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as ApiResponse;
        if (!response.ok) throw new Error(data.error || 'Street imagery lookup failed.');
        return data;
      })
      .then((data) => {
        const nextPhotos = data.photos ?? [];
        setPhotos(nextPhotos);
        setIndex(Math.min(Math.max(data.initialIndex ?? 0, 0), Math.max(0, nextPhotos.length - 1)));
        if (!nextPhotos.length) setError(data.message || 'No KartaView imagery is available near this round yet.');
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err instanceof Error ? err.message : 'Street imagery failed to load.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [latitude, longitude, photoId]);

  const current = photos[index];
  const isSphere = useMemo(
    () => Boolean(current && (current.projection === 'SPHERE' || current.fieldOfView >= 300)),
    [current],
  );

  useEffect(() => {
    viewerRef.current?.destroy();
    viewerRef.current = null;

    if (!current || !isSphere || !sphereRef.current) return;

    viewerRef.current = new Viewer({
      container: sphereRef.current,
      panorama: current.imageUrl,
      navbar: ['zoom', 'move', 'caption', 'fullscreen'],
      caption: 'KartaView street imagery',
      defaultYaw: ((current.heading || 0) * Math.PI) / 180,
      mousewheelCtrlKey: false,
      touchmoveTwoFingers: false,
    });

    return () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [current, isSphere]);

  const step = (direction: -1 | 1) => {
    setIndex((value) => Math.min(Math.max(value + direction, 0), Math.max(0, photos.length - 1)));
  };

  return (
    <div className="streetview-wrap">
      {loading && (
        <div className="map-error">
          <strong>Loading open street imagery…</strong>
          <span>{photoId ? 'Loading the admin-approved KartaView starting frame.' : 'Searching KartaView near this location.'}</span>
        </div>
      )}

      {!loading && current && (
        <>
          {isSphere ? (
            <div ref={sphereRef} className="streetview-canvas" aria-label="Interactive KartaView 360 panorama" />
          ) : (
            <div className="street-photo-stage">
              <img src={current.imageUrl} alt="KartaView street-level imagery near the round location" />
            </div>
          )}

          <div className="street-imagery-toolbar">
            <button type="button" onClick={() => step(-1)} disabled={index <= 0}>← Previous</button>
            <span>{index + 1} / {photos.length} · KartaView</span>
            <button type="button" onClick={() => step(1)} disabled={index >= photos.length - 1}>Next →</button>
          </div>
        </>
      )}

      {!loading && error && (
        <div className="map-error">
          <strong>Open street imagery unavailable</strong>
          <span>{error}</span>
          <span className="imagery-note">This round needs curated KartaView or GeoWeedo-hosted imagery before it should enter the live pool.</span>
        </div>
      )}
    </div>
  );
}
