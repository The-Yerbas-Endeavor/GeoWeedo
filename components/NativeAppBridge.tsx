'use client';

import { useEffect } from 'react';

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}

export default function NativeAppBridge() {
  useEffect(() => {
    const capacitor = window.Capacitor;
    if (!capacitor?.isNativePlatform?.()) return;

    const platform = capacitor.getPlatform?.() || 'native';
    const root = document.documentElement;

    root.dataset.nativeApp = 'true';
    root.dataset.nativePlatform = platform;
    root.classList.add('geoweedo-native-app', `geoweedo-native-${platform}`);

    window.dispatchEvent(
      new CustomEvent('geoweedo:native-ready', {
        detail: { platform },
      }),
    );

    return () => {
      delete root.dataset.nativeApp;
      delete root.dataset.nativePlatform;
      root.classList.remove('geoweedo-native-app', `geoweedo-native-${platform}`);
    };
  }, []);

  return null;
}
