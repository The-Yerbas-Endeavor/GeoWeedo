'use client';

import { useEffect, useState } from 'react';
import {
  isNativeApp,
  scanWeedoFactsCode,
  type WeedoFactsScanResult,
} from '@/lib/native';

type Props = {
  className?: string;
  onScan?: (result: WeedoFactsScanResult) => void | Promise<void>;
};

export default function WeedoFactsNativeScanner({ className = '', onScan }: Props) {
  const [native, setNative] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setNative(isNativeApp());
  }, []);

  if (!native) return null;

  const scan = async () => {
    if (scanning) return;
    setScanning(true);
    setError('');
    try {
      const result = await scanWeedoFactsCode();
      await onScan?.(result);
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : 'Unable to scan this product.';
      setError(message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className={`weedo-facts-native-scanner ${className}`.trim()}>
      <button
        type="button"
        className="weedo-facts-scan-button"
        onClick={scan}
        disabled={scanning}
        aria-busy={scanning}
      >
        <span aria-hidden="true">▣</span>
        {scanning ? 'Scanning…' : 'Scan Product'}
      </button>
      {error ? (
        <p className="weedo-facts-scan-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
