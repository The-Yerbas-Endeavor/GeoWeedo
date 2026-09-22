'use client';

type PluginListenerHandle = { remove?: () => Promise<void> | void };
type CapacitorPlugin = Record<string, (...args: any[]) => any>;

type CapacitorRuntime = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, CapacitorPlugin>;
  isPluginAvailable?: (name: string) => boolean;
  registerPlugin?: (name: string) => CapacitorPlugin;
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

export type NativeScannerUiState = {
  active: boolean;
  torchAvailable: boolean;
  torchOn: boolean;
  zoomAvailable: boolean;
  zoom: number;
  zoomMin: number;
  zoomMax: number;
};

const PRODUCT_BARCODE_FORMATS = [
  'QR_CODE',
  'DATA_MATRIX',
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
  'CODE_39',
  'CODE_93',
  'ITF',
  'CODABAR',
  'PDF_417',
  'AZTEC',
] as const;

const NATIVE_SCANNER_IDLE: NativeScannerUiState = {
  active: false,
  torchAvailable: false,
  torchOn: false,
  zoomAvailable: false,
  zoom: 1,
  zoomMin: 1,
  zoomMax: 1,
};

function runtime(): CapacitorRuntime | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Capacitor?: CapacitorRuntime }).Capacitor;
}

function plugin(name: string): CapacitorPlugin | undefined {
  const capacitor = runtime();
  if (!capacitor) return undefined;

  const existing = capacitor.Plugins?.[name];
  if (existing) return existing;

  // The GeoWeedo native apps load the production website remotely. In that
  // setup the native bridge exposes PluginHeaders, but the website bundle does
  // not import each installed Capacitor package and therefore does not call
  // registerPlugin() for it. Register the proxy lazily from the native header
  // so BarcodeScanner, Torch, Camera, Network, etc. are reachable from the
  // live web application.
  if (capacitor.isPluginAvailable?.(name) && capacitor.registerPlugin) {
    try {
      return capacitor.registerPlugin(name);
    } catch {
      return capacitor.Plugins?.[name];
    }
  }

  return undefined;
}

function dispatchNativeScannerState(state: NativeScannerUiState) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('geoweedo:native-scanner-state', { detail: state }));
}

async function readNativeScannerUiState(active = true): Promise<NativeScannerUiState> {
  if (!active || !isNativeApp()) return { ...NATIVE_SCANNER_IDLE };

  const scanner = plugin('BarcodeScanner');
  const torch = plugin('Torch');
  let zoom = 1;
  let zoomMin = 1;
  let zoomMax = 1;
  let torchAvailable = false;
  let torchOn = false;

  try {
    if (scanner?.getZoomRatio) zoom = Number((await scanner.getZoomRatio())?.zoomRatio ?? 1) || 1;
    if (scanner?.getMinZoomRatio) zoomMin = Number((await scanner.getMinZoomRatio())?.zoomRatio ?? 1) || 1;
    if (scanner?.getMaxZoomRatio) zoomMax = Number((await scanner.getMaxZoomRatio())?.zoomRatio ?? 1) || 1;
  } catch {}

  try {
    if (torch?.isAvailable) {
      torchAvailable = Boolean((await torch.isAvailable())?.available);
      if (torchAvailable && torch.isEnabled) torchOn = Boolean((await torch.isEnabled())?.enabled);
    } else if (scanner?.isTorchAvailable) {
      torchAvailable = Boolean((await scanner.isTorchAvailable())?.available);
      if (torchAvailable && scanner.isTorchEnabled) torchOn = Boolean((await scanner.isTorchEnabled())?.enabled);
    }
  } catch {}

  return {
    active: true,
    torchAvailable,
    torchOn,
    zoomAvailable: Boolean(scanner?.setZoomRatio && zoomMax > zoomMin),
    zoom,
    zoomMin,
    zoomMax,
  };
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

export function cancelNativeProductScanner() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('geoweedo:native-scanner-cancel'));
}

export async function setNativeScannerZoom(zoomRatio: number): Promise<void> {
  const scanner = plugin('BarcodeScanner');
  if (!isNativeApp() || !scanner?.setZoomRatio) return;
  const state = await readNativeScannerUiState(true);
  const next = Math.min(state.zoomMax, Math.max(state.zoomMin, Number(zoomRatio) || state.zoom));
  await scanner.setZoomRatio({ zoomRatio: next });
  dispatchNativeScannerState(await readNativeScannerUiState(true));
}

export async function toggleNativeScannerTorch(): Promise<void> {
  if (!isNativeApp()) return;
  const scanner = plugin('BarcodeScanner');
  const torch = plugin('Torch');
  if (torch?.toggle) await torch.toggle();
  else if (scanner?.toggleTorch) await scanner.toggleTorch();
  dispatchNativeScannerState(await readNativeScannerUiState(true));
}

async function disableNativeScannerTorch() {
  const scanner = plugin('BarcodeScanner');
  const torch = plugin('Torch');
  try {
    if (torch?.isEnabled && torch?.disable) {
      const state = await torch.isEnabled();
      if (state?.enabled) await torch.disable();
      return;
    }
    if (scanner?.isTorchEnabled && scanner?.disableTorch) {
      const state = await scanner.isTorchEnabled();
      if (state?.enabled) await scanner.disableTorch();
    }
  } catch {}
}

async function ensureNativeScannerPermission(scanner: CapacitorPlugin) {
  if (!scanner.checkPermissions || !scanner.requestPermissions) return;
  let camera = String((await scanner.checkPermissions())?.camera || 'prompt');
  if (camera === 'granted' || camera === 'limited') return;
  camera = String((await scanner.requestPermissions())?.camera || camera);
  if (camera !== 'granted' && camera !== 'limited') {
    throw new Error('Camera permission is required to scan product barcodes and QR codes.');
  }
}

async function scanWithCustomNativeScanner(): Promise<WeedoFactsScanResult | null> {
  const scanner = plugin('BarcodeScanner');
  if (!scanner?.startScan || !scanner?.stopScan || !scanner?.addListener) return null;

  if (scanner.isSupported) {
    const support = await scanner.isSupported();
    if (support?.supported === false) return null;
  }
  await ensureNativeScannerPermission(scanner);

  return new Promise<WeedoFactsScanResult>((resolve, reject) => {
    let settled = false;
    let barcodeHandle: PluginListenerHandle | undefined;
    let errorHandle: PluginListenerHandle | undefined;

    const cleanup = async () => {
      window.removeEventListener('geoweedo:native-scanner-cancel', onCancel);
      try { await barcodeHandle?.remove?.(); } catch {}
      try { await errorHandle?.remove?.(); } catch {}
      await disableNativeScannerTorch();
      try { await scanner.stopScan(); } catch {}
      document.documentElement.classList.remove('geoweedo-native-scanner-active');
      document.body?.classList.remove('geoweedo-native-scanner-active');
      dispatchNativeScannerState({ ...NATIVE_SCANNER_IDLE });
    };

    const finish = async (result?: WeedoFactsScanResult, error?: Error) => {
      if (settled) return;
      settled = true;
      await cleanup();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error('No barcode or QR code was captured.'));
    };

    const onCancel = () => { void finish(undefined, new Error('Scan cancelled.')); };
    window.addEventListener('geoweedo:native-scanner-cancel', onCancel);

    void (async () => {
      try {
        barcodeHandle = await scanner.addListener('barcodesScanned', (event: any) => {
          const barcode = Array.isArray(event?.barcodes)
            ? event.barcodes.find((item: any) => String(item?.rawValue || item?.displayValue || '').trim())
            : null;
          const value = String(barcode?.rawValue || barcode?.displayValue || '').trim();
          if (!value) return;
          void finish({ value, format: barcode?.format ?? null });
        });

        errorHandle = await scanner.addListener('scanError', (event: any) => {
          void finish(undefined, new Error(String(event?.message || 'Native camera scanner failed.')));
        });

        document.documentElement.classList.add('geoweedo-native-scanner-active');
        document.body?.classList.add('geoweedo-native-scanner-active');
        dispatchNativeScannerState({ ...NATIVE_SCANNER_IDLE, active: true });

        await scanner.startScan({
          formats: PRODUCT_BARCODE_FORMATS,
          lensFacing: 'BACK',
          resolution: 2,
        });
        dispatchNativeScannerState(await readNativeScannerUiState(true));
      } catch (error) {
        void finish(undefined, error instanceof Error ? error : new Error(String(error || 'Native camera scanner failed.')));
      }
    })();
  });
}

async function scanWithEnhancedNativeScanner(): Promise<WeedoFactsScanResult | null> {
  const scanner = plugin('BarcodeScanner');
  if (!scanner?.scan) return null;

  const platform = getNativePlatform();
  if (platform === 'android' && scanner.isGoogleBarcodeScannerModuleAvailable) {
    try {
      const state = await scanner.isGoogleBarcodeScannerModuleAvailable();
      if (!state?.available && scanner.installGoogleBarcodeScannerModule) {
        await scanner.installGoogleBarcodeScannerModule();
      }
    } catch {
      // If the Google scanner module cannot be prepared, scan() may still work.
      // Any real scan failure is handled by the legacy fallback below.
    }
  }

  const result = await scanner.scan({
    formats: PRODUCT_BARCODE_FORMATS,
    autoZoom: true,
  });
  const barcode = Array.isArray(result?.barcodes)
    ? result.barcodes.find((item: any) => String(item?.rawValue || item?.displayValue || '').trim())
    : null;
  const value = String(barcode?.rawValue || barcode?.displayValue || '').trim();
  if (!value) throw new Error('No barcode or QR code was captured.');

  return {
    value,
    format: barcode?.format ?? null,
  };
}

async function scanWithLegacyNativeScanner(): Promise<WeedoFactsScanResult> {
  const scanner = plugin('CapacitorBarcodeScanner');
  if (!scanner?.scanBarcode) {
    throw new Error('Native GeoWeedo Facts scanning is not available in this app build.');
  }

  const platform = getNativePlatform();
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
    ...(platform === 'android' ? { android: { scanningLibrary: 'zxing' } } : {}),
  });

  const value = String(result?.ScanResult || '').trim();
  if (!value) throw new Error('No barcode or QR code was captured.');

  return {
    value,
    format: result?.format ?? null,
  };
}

export async function scanWeedoFactsCode(): Promise<WeedoFactsScanResult> {
  if (!isNativeApp()) {
    throw new Error('Native GeoWeedo Facts scanning is available in the GeoWeedo Android and iOS apps.');
  }

  let detail: WeedoFactsScanResult;
  try {
    detail = (await scanWithCustomNativeScanner())
      || (await scanWithEnhancedNativeScanner())
      || (await scanWithLegacyNativeScanner());
  } catch (customError) {
    const message = customError instanceof Error ? customError.message : String(customError || '');
    if (/cancel|canceled|cancelled|permission/i.test(message)) throw customError;
    try {
      detail = (await scanWithEnhancedNativeScanner()) || (await scanWithLegacyNativeScanner());
    } catch (enhancedError) {
      const enhancedMessage = enhancedError instanceof Error ? enhancedError.message : String(enhancedError || '');
      if (/cancel|canceled|cancelled/i.test(enhancedMessage)) throw enhancedError;
      detail = await scanWithLegacyNativeScanner();
    }
  }

  await nativeHaptic('success');
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
      if (root.classList.contains('geoweedo-native-scanner-active')) {
        cancelNativeProductScanner();
        return;
      }
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
