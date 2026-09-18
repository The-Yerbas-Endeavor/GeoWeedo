'use client';

import { useEffect } from 'react';
import { getNativePlatform, installNativeListeners, isNativeApp } from '@/lib/native';

const scannerIdleState = {
  active: false,
  torchAvailable: false,
  torchOn: false,
  zoomAvailable: false,
  zoom: 1,
  zoomMin: 1,
  zoomMax: 1,
};

export default function NativeAppBridge() {
  useEffect(() => {
    if (!isNativeApp()) return;

    const platform = getNativePlatform();
    const root = document.documentElement;
    let removeNativeListeners: (() => void) | undefined;
    let removeAppStateListener: (() => Promise<void> | void) | undefined;
    let disposed = false;

    const resetScannerVisualState = () => {
      root.classList.remove('geoweedo-native-scanner-active');
      document.body?.classList.remove('geoweedo-native-scanner-active');
      window.dispatchEvent(new CustomEvent('geoweedo:native-scanner-state', { detail: scannerIdleState }));
    };

    const stopStaleScanner = async (force = false) => {
      const scannerWasActive = root.classList.contains('geoweedo-native-scanner-active');
      if (!force && !scannerWasActive) return;

      if (scannerWasActive) {
        window.dispatchEvent(new Event('geoweedo:native-scanner-cancel'));
      }

      try {
        const capacitor = (window as any).Capacitor;
        const scanner = capacitor?.Plugins?.BarcodeScanner;
        const torch = capacitor?.Plugins?.Torch;

        if (torch?.isEnabled && torch?.disable) {
          const state = await torch.isEnabled().catch(() => null);
          if (state?.enabled) await torch.disable().catch(() => undefined);
        }
        await scanner?.stopScan?.().catch?.(() => undefined);
      } catch (error) {
        console.warn('[GeoWeedo native] stale scanner cleanup failed', error);
      } finally {
        resetScannerVisualState();
      }
    };

    root.dataset.nativeApp = 'true';
    root.dataset.nativePlatform = platform;
    root.classList.add('geoweedo-native-app', `geoweedo-native-${platform}`);

    // A scanner can be left transparent if Android suspends the app while the
    // camera preview is active. Always normalize the WebView before exposing
    // the live page again so a restored task cannot remain a black screen.
    resetScannerVisualState();
    void stopStaleScanner(true);

    const onVisibilityChange = () => {
      if (document.hidden) {
        void stopStaleScanner(false);
      } else if (root.classList.contains('geoweedo-native-scanner-active')) {
        void stopStaleScanner(true);
      } else {
        resetScannerVisualState();
      }
    };
    const onPageHide = () => { void stopStaleScanner(false); };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    const app = (window as any).Capacitor?.Plugins?.App;
    if (app?.addListener) {
      void app.addListener('appStateChange', ({ isActive }: { isActive?: boolean }) => {
        if (isActive === false) {
          void stopStaleScanner(false);
          return;
        }
        if (root.classList.contains('geoweedo-native-scanner-active')) {
          void stopStaleScanner(true);
        } else {
          resetScannerVisualState();
        }
      }).then((handle: { remove?: () => Promise<void> | void } | undefined) => {
        if (disposed) {
          void handle?.remove?.();
          return;
        }
        removeAppStateListener = handle?.remove;
      }).catch((error: unknown) => {
        console.warn('[GeoWeedo native] app-state recovery listener failed', error);
      });
    }

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
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      void stopStaleScanner(false);
      void removeAppStateListener?.();
      removeNativeListeners?.();
      delete root.dataset.nativeApp;
      delete root.dataset.nativePlatform;
      delete root.dataset.nativeNetwork;
      root.classList.remove('geoweedo-native-app', `geoweedo-native-${platform}`);
      resetScannerVisualState();
    };
  }, []);

  return null;
}
