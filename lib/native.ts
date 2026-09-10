'use client';

type PluginListenerHandle = { remove?: () => Promise<void> | void };
type CapacitorPlugin = Record<string, (...args: any[]) => any>;

type CapacitorRuntime = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, CapacitorPlugin>;
};

export type NativePlatform = 'android' | 'ios' | 'web' | 'native';
export type NativeNetworkStatus = {
  connected: boolean;
  connectionType: 'wifi' | 'cellular' | 'none' | 'unknown' | string;
};

export type NativePosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
};

export type NativeShareOptions = {
  title?: string;
  text?: string;
  url?: string;
};

export type WeedoFactsScanResult = {
  value: string;
  format: number | string | null;
};

function runtime(): CapacitorRuntime | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Capacitor?: CapacitorRuntime }).Capacitor;
}

function plugin(name: string): CapacitorPlugin | undefined {
  return runtime()?.Plugins?.[name];
}

export function isNativeApp(): boolean {
  return Boolean(runtime()?.isNativePlatform?.());
}

export function getNativePlatform(): NativePlatform {
  return (runtime()?.getPlatform?.() as NativePlatform | undefined) || 'web';
}

export async function getCurrentNativePosition(): Promise<NativePosition> {
  const geolocation = plugin('Geolocation');

  if (!isNativeApp() || !geolocation) {
    if (!navigator.geolocation) throw new Error('Geolocation is not available on this device.');
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      });
    });
    const { coords } = position;
    return {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      altitude: coords.altitude,
      altitudeAccuracy: coords.altitudeAccuracy,
      heading: coords.heading,
      speed: coords.speed,
      timestamp: position.timestamp,
    };
  }

  const permissions = await geolocation.requestPermissions?.();
  const permission = permissions?.location || permissions?.coarseLocation;
  if (permission && permission !== 'granted') {
    throw new Error('Location permission was not granted.');
  }

  const position = await geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 30000,
  });
  const coords = position.coords;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy,
    altitude: coords.altitude ?? null,
    altitudeAccuracy: coords.altitudeAccuracy ?? null,
    heading: coords.heading ?? null,
    speed: coords.speed ?? null,
    timestamp: position.timestamp,
  };
}

export async function nativeShare(options: NativeShareOptions): Promise<void> {
  const share = plugin('Share');
  if (isNativeApp() && share?.share) {
    await share.share(options);
    return;
  }

  if (navigator.share) {
    await navigator.share(options);
    return;
  }

  const fallback = options.url || options.text;
  if (fallback && navigator.clipboard) {
    await navigator.clipboard.writeText(fallback);
    return;
  }

  throw new Error('Sharing is not available on this device.');
}

export async function nativeHaptic(
  kind: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection' = 'light',
): Promise<void> {
  if (!isNativeApp()) return;
  const haptics = plugin('Haptics');
  if (!haptics) return;

  if (kind === 'selection') {
    await haptics.selectionChanged?.();
    return;
  }
  if (kind === 'success' || kind === 'warning' || kind === 'error') {
    await haptics.notification?.({ type: kind.toUpperCase() });
    return;
  }
  await haptics.impact?.({ style: kind.toUpperCase() });
}

export async function getNativeNetworkStatus(): Promise<NativeNetworkStatus> {
  const network = plugin('Network');
  if (isNativeApp() && network?.getStatus) {
    return network.getStatus();
  }
  return {
    connected: typeof navigator === 'undefined' ? true : navigator.onLine,
    connectionType: typeof navigator !== 'undefined' && navigator.onLine ? 'unknown' : 'none',
  };
}

export async function scanWeedoFactsCode(): Promise<WeedoFactsScanResult> {
  const scanner = plugin('CapacitorBarcodeScanner');
  if (!isNativeApp() || !scanner?.scanBarcode) {
    throw new Error('Native Weedo Facts scanning is available in the GeoWeedo Android and iOS apps.');
  }

  const result = await scanner.scanBarcode({
    hint: 17,
    scanInstructions: 'Scan a product barcode or QR code',
    scanButton: false,
    scanText: 'Scan',
    cameraDirection: 1,
    scanOrientation: 3,
    cancelButtonAccessibilityLabel: 'Cancel product scan',
    torchButtonOnAccessibilityLabel: 'Turn scanner light off',
    torchButtonOffAccessibilityLabel: 'Turn scanner light on',
    android: { scanningLibrary: 'mlkit' },
  });

  const value = String(result?.ScanResult || '').trim();
  if (!value) throw new Error('No barcode or QR code was captured.');

  await nativeHaptic('success');
  const detail: WeedoFactsScanResult = {
    value,
    format: result?.format ?? null,
  };
  window.dispatchEvent(new CustomEvent('geoweedo:weedo-facts-scanned', { detail }));
  return detail;
}

export async function installNativeListeners(): Promise<() => void> {
  if (!isNativeApp()) return () => undefined;

  const handles: PluginListenerHandle[] = [];
  const root = document.documentElement;
  const network = plugin('Network');
  const app = plugin('App');

  if (network?.getStatus) {
    const initial: NativeNetworkStatus = await network.getStatus();
    root.dataset.nativeNetwork = initial.connected ? initial.connectionType : 'offline';
    window.dispatchEvent(new CustomEvent('geoweedo:native-network', { detail: initial }));
  }

  if (network?.addListener) {
    const handle = await network.addListener('networkStatusChange', (status: NativeNetworkStatus) => {
      root.dataset.nativeNetwork = status.connected ? status.connectionType : 'offline';
      window.dispatchEvent(new CustomEvent('geoweedo:native-network', { detail: status }));
    });
    if (handle) handles.push(handle);
  }

  if (getNativePlatform() === 'android' && app?.addListener) {
    const handle = await app.addListener('backButton', async ({ canGoBack }: { canGoBack?: boolean }) => {
      window.dispatchEvent(new CustomEvent('geoweedo:native-back'));
      if (canGoBack && window.history.length > 1 && window.location.pathname !== '/') {
        window.history.back();
        return;
      }
      await app.exitApp?.();
    });
    if (handle) handles.push(handle);
  }

  return () => {
    for (const handle of handles) void handle.remove?.();
    delete root.dataset.nativeNetwork;
  };
}
