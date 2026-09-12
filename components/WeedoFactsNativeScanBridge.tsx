'use client';

import { useEffect, useState } from 'react';

type CapacitorPlugin = Record<string, (...args: any[]) => any>;
type CapacitorRuntime = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, CapacitorPlugin>;
};

function getCapacitor(): CapacitorRuntime | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Capacitor?: CapacitorRuntime }).Capacitor;
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export default function WeedoFactsNativeScanBridge() {
  const [error, setError] = useState('');

  useEffect(() => {
    const capacitor = getCapacitor();
    if (!capacitor?.isNativePlatform?.()) return;

    const scanner = capacitor.Plugins?.CapacitorBarcodeScanner;
    if (!scanner?.scanBarcode) return;

    const root = document.documentElement;
    root.classList.add('geoweedo-native-weedo-scanner');

    const handleClick = async (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest('.weedoFactsScanActions .weedoFactsScanButton')
        : null;
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setError('');

      try {
        const platform = capacitor.getPlatform?.();
        const result = await scanner.scanBarcode({
          hint: 17,
          scanInstructions: 'Scan a cannabis package barcode or QR code',
          scanButton: false,
          scanText: 'Scan',
          cameraDirection: 1,
          scanOrientation: 3,
          cancelButtonAccessibilityLabel: 'Cancel product scan',
          torchButtonOnAccessibilityLabel: 'Turn scanner light off',
          torchButtonOffAccessibilityLabel: 'Turn scanner light on',
          ...(platform === 'android' ? { android: { scanningLibrary: 'zxing' } } : {}),
        });

        const value = String(result?.ScanResult || '').trim();
        if (!value) return;

        const input = document.querySelector<HTMLInputElement>('#weedo-facts-identifier');
        const form = input?.closest('form');
        if (!input || !(form instanceof HTMLFormElement)) {
          throw new Error('The GeoWeedo Facts lookup form is not available.');
        }

        setReactInputValue(input, value);
        await new Promise(resolve => setTimeout(resolve, 0));
        form.requestSubmit();
      } catch (scanError) {
        const message = scanError instanceof Error ? scanError.message : String(scanError || '');
        if (/permission|denied|camera access/i.test(message)) {
          setError(
            capacitor.getPlatform?.() === 'android'
              ? 'Camera permission is blocked. Open Android Settings → Apps → GeoWeedo → Permissions → Camera → Allow, then tap Scan package again.'
              : 'Camera permission is blocked. Open Settings → GeoWeedo → Camera, enable access, then tap Scan package again.',
          );
        } else if (!/cancel/i.test(message)) {
          setError(message || 'Unable to start the native product scanner.');
        }
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
      root.classList.remove('geoweedo-native-weedo-scanner');
    };
  }, []);

  return error ? <p className="weedoFactsError weedoFactsNativeScanError" role="alert">{error}</p> : null;
}
