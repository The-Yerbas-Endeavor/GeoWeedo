'use client';

import { useRef, useState, type CSSProperties } from 'react';
import {
  canUseNativePhotoScanner,
  scanBarcodeFromImageFile,
  scanWeedoFactsPhotoNative,
} from '@/lib/photoBarcodeScanner';
import type { WeedoFactsScanResult } from '@/lib/native';

type Props = {
  onScan: (result: WeedoFactsScanResult) => Promise<void> | void;
  onError?: (message: string) => void;
  beforeScan?: () => Promise<void> | void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
};

export default function PhotoBarcodeScanButton({
  onScan,
  onError,
  beforeScan,
  disabled = false,
  className,
  style,
  label = '🖼️ Scan from photo',
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);
  const [internalError, setInternalError] = useState('');

  function reportError(message: string) {
    if (onError) onError(message);
    else setInternalError(message);
  }

  async function deliver(result: WeedoFactsScanResult) {
    setInternalError('');
    await onScan(result);
  }

  async function choosePhoto() {
    if (disabled || pending) return;
    setInternalError('');

    try {
      await beforeScan?.();
    } catch {}

    if (!canUseNativePhotoScanner()) {
      inputRef.current?.click();
      return;
    }

    setPending(true);
    try {
      await deliver(await scanWeedoFactsPhotoNative());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Photo scan failed.');
      if (!/cancel/i.test(message)) reportError(message);
    } finally {
      setPending(false);
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setPending(true);
    setInternalError('');
    try {
      await deliver(await scanBarcodeFromImageFile(file));
    } catch (error) {
      reportError(error instanceof Error ? error.message : 'No QR code or barcode was found in that image.');
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        onClick={() => void choosePhoto()}
        disabled={disabled || pending}
        data-geoweedo-photo-scanner="1"
      >
        {pending ? 'Reading photo…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void handleFile(event.target.files?.[0] || null)}
      />
      {internalError ? <small role="alert" style={{ display: 'block', marginTop: 6 }}>{internalError}</small> : null}
    </>
  );
}
