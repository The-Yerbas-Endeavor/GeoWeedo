'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  cancelNativeProductScanner,
  setNativeScannerZoom,
  toggleNativeScannerTorch,
  type NativeScannerUiState,
} from '@/lib/native';

const idleState: NativeScannerUiState = {
  active: false,
  torchAvailable: false,
  torchOn: false,
  zoomAvailable: false,
  zoom: 1,
  zoomMin: 1,
  zoomMax: 1,
};

export default function NativeProductScannerOverlay() {
  const [state, setState] = useState<NativeScannerUiState>(idleState);
  const [zoomPending, setZoomPending] = useState(false);
  const [torchPending, setTorchPending] = useState(false);

  useEffect(() => {
    const handleState = (event: Event) => {
      const detail = (event as CustomEvent<NativeScannerUiState>).detail;
      if (!detail) return;
      setState(detail);
      if (!detail.active) {
        setZoomPending(false);
        setTorchPending(false);
      }
    };

    window.addEventListener('geoweedo:native-scanner-state', handleState);
    return () => window.removeEventListener('geoweedo:native-scanner-state', handleState);
  }, []);

  const zoomStep = useMemo(() => {
    const span = Math.max(0, state.zoomMax - state.zoomMin);
    if (span <= 1) return 0.05;
    if (span <= 4) return 0.1;
    return 0.25;
  }, [state.zoomMax, state.zoomMin]);

  if (!state.active) return null;

  async function toggleTorch() {
    if (torchPending) return;
    setTorchPending(true);
    try {
      await toggleNativeScannerTorch();
    } finally {
      setTorchPending(false);
    }
  }

  async function changeZoom(value: number) {
    if (zoomPending) return;
    setZoomPending(true);
    try {
      await setNativeScannerZoom(value);
    } finally {
      setZoomPending(false);
    }
  }

  return (
    <div className="native-product-scanner" data-geoweedo-native-scanner-overlay="1" role="dialog" aria-modal="true" aria-label="Scan product barcode or QR code">
      <div className="native-product-scanner__top">
        <div>
          <span>GEOWEEDO FACTS</span>
          <strong>Scan product</strong>
          <small>QR · UPC · EAN · package barcode</small>
        </div>
        <button type="button" onClick={cancelNativeProductScanner} aria-label="Cancel scanner">×</button>
      </div>

      <div className="native-product-scanner__view" aria-hidden="true">
        <div className="native-product-scanner__target">
          <i className="tl" />
          <i className="tr" />
          <i className="bl" />
          <i className="br" />
        </div>
      </div>

      <div className="native-product-scanner__controls">
        <p>Hold the code steady inside the frame. Native autofocus runs continuously; use zoom for small or glossy labels.</p>

        <div className="native-product-scanner__buttons">
          {state.torchAvailable ? (
            <button type="button" onClick={() => void toggleTorch()} disabled={torchPending} aria-pressed={state.torchOn}>
              {state.torchOn ? '🔦 Light on' : '🔦 Light'}
            </button>
          ) : null}
          <button type="button" onClick={cancelNativeProductScanner}>Cancel</button>
        </div>

        {state.zoomAvailable ? (
          <label className="native-product-scanner__zoom">
            <span>Zoom <strong>{state.zoom.toFixed(1)}×</strong></span>
            <input
              type="range"
              min={state.zoomMin}
              max={state.zoomMax}
              step={zoomStep}
              value={state.zoom}
              disabled={zoomPending}
              onChange={(event) => void changeZoom(Number(event.target.value))}
              aria-label="Scanner camera zoom"
            />
            <small>{state.zoomMin.toFixed(1)}×</small>
            <small>{state.zoomMax.toFixed(1)}×</small>
          </label>
        ) : null}
      </div>
    </div>
  );
}
