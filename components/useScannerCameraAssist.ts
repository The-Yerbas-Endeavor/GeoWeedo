'use client';

import { useCallback, useRef, useState } from 'react';

type StreamRef = { current: MediaStream | null };

export type ScannerFocusPoint = { x: number; y: number } | null;

export function useScannerCameraAssist(streamRef: StreamRef) {
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomAvailable, setZoomAvailable] = useState(false);
  const [zoom, setZoomState] = useState(1);
  const [zoomMin, setZoomMin] = useState(1);
  const [zoomMax, setZoomMax] = useState(1);
  const [zoomStep, setZoomStep] = useState(0.1);
  const [focusAvailable, setFocusAvailable] = useState(false);
  const [focusPoint, setFocusPoint] = useState<ScannerFocusPoint>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = null;
    setTorchAvailable(false);
    setTorchOn(false);
    setZoomAvailable(false);
    setZoomState(1);
    setZoomMin(1);
    setZoomMax(1);
    setZoomStep(0.1);
    setFocusAvailable(false);
    setFocusPoint(null);
  }, []);

  const configure = useCallback(async (stream: MediaStream | null) => {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) {
      reset();
      return;
    }

    try {
      const capabilities = (track as any).getCapabilities?.() || {};
      const settings = (track as any).getSettings?.() || {};
      const advanced: Record<string, unknown> = {};
      if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) advanced.focusMode = 'continuous';
      if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes('continuous')) advanced.exposureMode = 'continuous';
      if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes('continuous')) advanced.whiteBalanceMode = 'continuous';
      if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] } as any);

      const zoomCapability = capabilities.zoom;
      const min = Number(zoomCapability?.min);
      const max = Number(zoomCapability?.max);
      const step = Number(zoomCapability?.step);
      const currentZoom = Number(settings.zoom);
      const hasZoom = Number.isFinite(min) && Number.isFinite(max) && max > min;

      setTorchAvailable(capabilities.torch === true);
      setTorchOn(false);
      setZoomAvailable(hasZoom);
      setZoomMin(hasZoom ? min : 1);
      setZoomMax(hasZoom ? max : 1);
      setZoomStep(hasZoom && Number.isFinite(step) && step > 0 ? step : 0.1);
      setZoomState(hasZoom && Number.isFinite(currentZoom) ? Math.min(max, Math.max(min, currentZoom)) : hasZoom ? min : 1);
      setFocusAvailable(Array.isArray(capabilities.focusMode) && capabilities.focusMode.some((mode: string) => mode === 'single-shot' || mode === 'continuous'));
    } catch {
      // Camera enhancement support is best-effort. Scanning still works without it.
    }
  }, [reset]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track || !torchAvailable) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as any);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
      setTorchOn(false);
    }
  }, [streamRef, torchAvailable, torchOn]);

  const setZoom = useCallback(async (value: number) => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track || !zoomAvailable) return;
    const next = Math.min(zoomMax, Math.max(zoomMin, value));
    try {
      await track.applyConstraints({ advanced: [{ zoom: next }] } as any);
      setZoomState(next);
    } catch {
      setZoomAvailable(false);
    }
  }, [streamRef, zoomAvailable, zoomMax, zoomMin]);

  const focusFromPointer = useCallback(async (event: { currentTarget: EventTarget & HTMLElement; clientX: number; clientY: number }) => {
    if (!focusAvailable) return;
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = {
      x: Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100)),
    };
    setFocusPoint(point);
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => setFocusPoint(null), 750);

    try {
      const capabilities = (track as any).getCapabilities?.() || {};
      const focusModes = Array.isArray(capabilities.focusMode) ? capabilities.focusMode : [];
      if (focusModes.includes('single-shot')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] } as any);
        if (focusModes.includes('continuous')) {
          window.setTimeout(() => {
            void track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any).catch(() => undefined);
          }, 450);
        }
      } else if (focusModes.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any);
      }
    } catch {
      // Visual tap feedback still helps users hold the code steady even when the browser hides focus controls.
    }
  }, [focusAvailable, streamRef]);

  return {
    configure,
    reset,
    torchAvailable,
    torchOn,
    toggleTorch,
    zoomAvailable,
    zoom,
    zoomMin,
    zoomMax,
    zoomStep,
    setZoom,
    focusAvailable,
    focusPoint,
    focusFromPointer,
  };
}
