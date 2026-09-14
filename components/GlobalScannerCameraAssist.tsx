'use client';

import { useEffect, useRef, useState } from 'react';
import ScannerCameraAssistControls from './ScannerCameraAssistControls';
import { useScannerCameraAssist } from './useScannerCameraAssist';

function liveCameraStream(video: HTMLVideoElement): MediaStream | null {
  const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
  const track = stream?.getVideoTracks?.()[0];
  return track?.readyState === 'live' ? stream : null;
}

export default function GlobalScannerCameraAssist() {
  const streamRef = useRef<MediaStream | null>(null);
  const [activeVideo, setActiveVideo] = useState<HTMLVideoElement | null>(null);
  const [activeTrackId, setActiveTrackId] = useState('');
  const camera = useScannerCameraAssist(streamRef);

  useEffect(() => {
    const findActiveScanner = () => {
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
      const nextVideo = videos.find(video => {
        const stream = liveCameraStream(video);
        if (!stream) return false;
        const rect = video.getBoundingClientRect();
        return rect.width > 40 && rect.height > 40;
      }) || null;
      const nextStream = nextVideo ? liveCameraStream(nextVideo) : null;
      const nextTrackId = nextStream?.getVideoTracks?.()[0]?.id || '';

      if (!nextVideo || !nextStream) {
        if (activeTrackId) {
          streamRef.current = null;
          setActiveVideo(null);
          setActiveTrackId('');
          camera.reset();
        }
        return;
      }

      if (nextTrackId !== activeTrackId) {
        streamRef.current = nextStream;
        setActiveVideo(nextVideo);
        setActiveTrackId(nextTrackId);
        void camera.configure(nextStream);
      } else if (nextVideo !== activeVideo) {
        setActiveVideo(nextVideo);
      }
    };

    findActiveScanner();
    const interval = window.setInterval(findActiveScanner, 250);
    const observer = new MutationObserver(findActiveScanner);
    observer.observe(document.body, { subtree: true, childList: true });
    window.addEventListener('resize', findActiveScanner);
    window.addEventListener('orientationchange', findActiveScanner);

    return () => {
      window.clearInterval(interval);
      observer.disconnect();
      window.removeEventListener('resize', findActiveScanner);
      window.removeEventListener('orientationchange', findActiveScanner);
      streamRef.current = null;
      camera.reset();
    };
  }, [activeTrackId, activeVideo, camera.configure, camera.reset]);

  useEffect(() => {
    if (!activeVideo || !camera.focusAvailable) return;

    const refocus = (event: PointerEvent) => {
      const rect = activeVideo.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      const interactiveTarget = event.target instanceof Element
        ? event.target.closest('button, input, a, select, textarea, [role="button"]')
        : null;
      if (interactiveTarget) return;
      void camera.focusFromPointer({
        currentTarget: activeVideo,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };

    document.addEventListener('pointerup', refocus, true);
    return () => document.removeEventListener('pointerup', refocus, true);
  }, [activeVideo, camera.focusAvailable, camera.focusFromPointer]);

  if (!activeVideo || !activeTrackId) return null;

  const rect = activeVideo.getBoundingClientRect();
  const focusPoint = camera.focusPoint;
  const focusLeft = focusPoint ? rect.left + (focusPoint.x / 100) * rect.width : 0;
  const focusTop = focusPoint ? rect.top + (focusPoint.y / 100) * rect.height : 0;

  return (
    <>
      {focusPoint ? (
        <span
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: focusLeft,
            top: focusTop,
            width: 48,
            height: 48,
            transform: 'translate(-50%, -50%)',
            border: '2px solid rgba(214,255,188,.98)',
            borderRadius: 10,
            boxShadow: '0 0 0 1px rgba(0,0,0,.6), 0 0 18px rgba(126,217,87,.65)',
            pointerEvents: 'none',
            zIndex: 10060,
          }}
        />
      ) : null}

      {(camera.torchAvailable || camera.zoomAvailable || camera.focusAvailable) ? (
        <div
          data-geoweedo-scanner-assist="1"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
            transform: 'translateX(-50%)',
            zIndex: 10055,
            width: 'min(560px, calc(100% - 24px))',
            padding: '10px 4px 0',
            border: '1px solid rgba(126,217,87,.28)',
            borderRadius: 15,
            background: 'rgba(7,16,9,.94)',
            boxShadow: '0 16px 44px rgba(0,0,0,.48)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <ScannerCameraAssistControls
            torchAvailable={camera.torchAvailable}
            torchOn={camera.torchOn}
            toggleTorch={camera.toggleTorch}
            zoomAvailable={camera.zoomAvailable}
            zoom={camera.zoom}
            zoomMin={camera.zoomMin}
            zoomMax={camera.zoomMax}
            zoomStep={camera.zoomStep}
            setZoom={camera.setZoom}
            focusAvailable={camera.focusAvailable}
          />
        </div>
      ) : null}
    </>
  );
}
