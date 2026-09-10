'use client';

import { useEffect } from 'react';
import { getNativePlatform, installNativeListeners, isNativeApp } from '@/lib/native';

export default function NativeAppBridge() {
  useEffect(() => {
    if (!isNativeApp()) return;

    const platform = getNativePlatform();
    const root = document.documentElement;
    let removeNativeListeners: (() => void) | undefined;
    let disposed = false;

    root.dataset.nativeApp = 'true';
    root.dataset.nativePlatform = platform;
    root.classList.add('geoweedo-native-app', `geoweedo-native-${platform}`);

    window.dispatchEvent(
      new CustomEvent('geoweedo:native-ready', {
        detail: { platform },
      }),
    );

    void installNativeListeners()
      .then((remove) => {
        if (disposed) {
          remove();
          return;
        }
        removeNativeListeners = remove;
      })
      .catch((error) => {
        console.warn('[GeoWeedo native] listener setup failed', error);
      });

    return () => {
      disposed = true;
      removeNativeListeners?.();
      delete root.dataset.nativeApp;
      delete root.dataset.nativePlatform;
      delete root.dataset.nativeNetwork;
      root.classList.remove('geoweedo-native-app', `geoweedo-native-${platform}`);
    };
  }, []);

  return null;
}
