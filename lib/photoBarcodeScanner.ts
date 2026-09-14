'use client';

import { isNativeApp, nativeHaptic, type WeedoFactsScanResult } from '@/lib/native';

type CapacitorPlugin = Record<string, (...args: any[]) => any>;
type CapacitorRuntime = {
  Plugins?: Record<string, CapacitorPlugin>;
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

const BROWSER_BARCODE_FORMATS = [
  'qr_code',
  'data_matrix',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'code_93',
  'itf',
  'codabar',
  'pdf417',
  'aztec',
];

let zxingLoader: Promise<any> | null = null;

function runtime(): CapacitorRuntime | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Capacitor?: CapacitorRuntime }).Capacitor;
}

function plugin(name: string): CapacitorPlugin | undefined {
  return runtime()?.Plugins?.[name];
}

function firstDecodedBarcode(barcodes: any[]): WeedoFactsScanResult | null {
  const barcode = Array.isArray(barcodes)
    ? barcodes.find((item: any) => String(item?.rawValue || item?.displayValue || '').trim())
    : null;
  const value = String(barcode?.rawValue || barcode?.displayValue || '').trim();
  if (!value) return null;
  return { value, format: barcode?.format ?? null };
}

function loadZxingBrowser() {
  const current = (window as any).ZXingBrowser;
  if (current?.BrowserMultiFormatReader) return Promise.resolve(current);
  if (zxingLoader) return zxingLoader;

  zxingLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-geoweedo-zxing]');
    const finish = () => {
      const api = (window as any).ZXingBrowser;
      if (api?.BrowserMultiFormatReader) resolve(api);
      else reject(new Error('Compatible photo barcode decoder could not load.'));
    };

    if (existing) {
      if ((window as any).ZXingBrowser?.BrowserMultiFormatReader) {
        finish();
        return;
      }
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => reject(new Error('Compatible photo barcode decoder could not load.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.geoweedoZxing = '1';
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Compatible photo barcode decoder could not load.')), { once: true });
    document.head.appendChild(script);
  });

  return zxingLoader;
}

function configureZxingReader(zxing: any) {
  const barcodeFormat = zxing?.BarcodeFormat;
  const decodeHintType = zxing?.DecodeHintType;
  const formats = barcodeFormat
    ? [
        barcodeFormat.QR_CODE,
        barcodeFormat.DATA_MATRIX,
        barcodeFormat.UPC_A,
        barcodeFormat.UPC_E,
        barcodeFormat.EAN_13,
        barcodeFormat.EAN_8,
        barcodeFormat.CODE_128,
        barcodeFormat.CODE_39,
        barcodeFormat.CODE_93,
        barcodeFormat.ITF,
        barcodeFormat.CODABAR,
        barcodeFormat.PDF_417,
        barcodeFormat.AZTEC,
      ].filter((format: unknown) => format !== undefined && format !== null)
    : [];

  if (decodeHintType && typeof Map !== 'undefined') {
    const hints = new Map<any, any>();
    if (formats.length && decodeHintType.POSSIBLE_FORMATS !== undefined) hints.set(decodeHintType.POSSIBLE_FORMATS, formats);
    if (decodeHintType.TRY_HARDER !== undefined) hints.set(decodeHintType.TRY_HARDER, true);
    if (decodeHintType.ALSO_INVERTED !== undefined) hints.set(decodeHintType.ALSO_INVERTED, true);
    return new zxing.BrowserMultiFormatReader(hints);
  }

  const reader = new zxing.BrowserMultiFormatReader();
  if (formats.length) reader.possibleFormats = formats;
  return reader;
}

async function decodeWithBarcodeDetector(blob: Blob): Promise<WeedoFactsScanResult | null> {
  const BarcodeDetectorCtor = (window as any).BarcodeDetector;
  if (!BarcodeDetectorCtor || typeof createImageBitmap !== 'function') return null;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    let detector: any;
    if (typeof BarcodeDetectorCtor.getSupportedFormats === 'function') {
      const supported = await BarcodeDetectorCtor.getSupportedFormats();
      const formats = BROWSER_BARCODE_FORMATS.filter(format => supported.includes(format));
      detector = formats.length ? new BarcodeDetectorCtor({ formats }) : new BarcodeDetectorCtor();
    } else {
      detector = new BarcodeDetectorCtor();
    }
    const codes = await detector.detect(bitmap);
    const hit = Array.isArray(codes) ? codes.find((code: any) => String(code?.rawValue || '').trim()) : null;
    const value = String(hit?.rawValue || '').trim();
    return value ? { value, format: hit?.format ?? null } : null;
  } catch {
    return null;
  } finally {
    try { bitmap?.close?.(); } catch {}
  }
}

async function decodeWithZxing(blob: Blob): Promise<WeedoFactsScanResult | null> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The selected image could not be opened.'));
    });

    const zxing = await loadZxingBrowser();
    const reader = configureZxingReader(zxing);
    const result = await reader.decodeFromImageElement(image);
    const value = String(result?.getText?.() || result?.text || '').trim();
    return value ? { value, format: result?.getBarcodeFormat?.() ?? result?.format ?? null } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function scanBarcodeFromImageBlob(blob: Blob): Promise<WeedoFactsScanResult> {
  if (!blob || !blob.type.startsWith('image/')) {
    throw new Error('Choose a photo or screenshot containing a QR code or barcode.');
  }

  const native = await decodeWithBarcodeDetector(blob);
  if (native) return native;

  const zxing = await decodeWithZxing(blob);
  if (zxing) return zxing;

  throw new Error('No QR code or barcode was found in that image. Try a closer, sharper photo with the entire code visible.');
}

export async function scanBarcodeFromImageFile(file: File): Promise<WeedoFactsScanResult> {
  return scanBarcodeFromImageBlob(file);
}

export function canUseNativePhotoScanner(): boolean {
  const scanner = plugin('BarcodeScanner');
  const camera = plugin('Camera');
  return Boolean(isNativeApp() && scanner?.readBarcodesFromImage && camera?.getPhoto);
}

export async function scanWeedoFactsPhotoNative(): Promise<WeedoFactsScanResult> {
  if (!canUseNativePhotoScanner()) {
    throw new Error('Native photo scanning requires the current GeoWeedo app build.');
  }

  const camera = plugin('Camera')!;
  const scanner = plugin('BarcodeScanner')!;

  let photo: any;
  try {
    photo = await camera.getPhoto({
      source: 'PHOTOS',
      resultType: 'uri',
      quality: 100,
      allowEditing: false,
      correctOrientation: true,
      saveToGallery: false,
      promptLabelHeader: 'Scan from photo',
      promptLabelPhoto: 'Choose product photo',
      promptLabelCancel: 'Cancel',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/cancel|canceled|cancelled|user cancelled/i.test(message)) throw new Error('Photo selection cancelled.');
    throw error;
  }

  const path = String(photo?.path || '').trim();
  if (path) {
    const result = await scanner.readBarcodesFromImage({ path, formats: PRODUCT_BARCODE_FORMATS });
    const hit = firstDecodedBarcode(result?.barcodes || []);
    if (hit) {
      await nativeHaptic('success');
      return hit;
    }
  }

  const webPath = String(photo?.webPath || '').trim();
  if (webPath) {
    const response = await fetch(webPath);
    if (response.ok) {
      const hit = await scanBarcodeFromImageBlob(await response.blob());
      await nativeHaptic('success');
      return hit;
    }
  }

  throw new Error('No QR code or barcode was found in that photo. Try a closer, sharper photo with the entire code visible.');
}
