'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isNativeApp, scanWeedoFactsCode } from '@/lib/native';

let zxingLoader: Promise<any> | null = null;

function loadZxingBrowser() {
  const current = (window as any).ZXingBrowser;
  if (current?.BrowserMultiFormatReader) return Promise.resolve(current);
  if (zxingLoader) return zxingLoader;

  zxingLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-geoweedo-zxing]');
    const finish = () => {
      const api = (window as any).ZXingBrowser;
      if (api?.BrowserMultiFormatReader) resolve(api);
      else reject(new Error('Compatible barcode scanner could not load.'));
    };

    if (existing) {
      if ((window as any).ZXingBrowser?.BrowserMultiFormatReader) {
        finish();
        return;
      }
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => reject(new Error('Compatible barcode scanner could not load.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.geoweedoZxing = '1';
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Compatible barcode scanner could not load.')), { once: true });
    document.head.appendChild(script);
  });

  return zxingLoader;
}

const scannerVideoConstraints: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30, max: 60 },
};

const browserFormats = [
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

async function tuneScannerStream(stream: MediaStream | null) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return;
  try {
    const capabilities = (track as any).getCapabilities?.();
    const advanced: Record<string, unknown> = {};
    if (Array.isArray(capabilities?.focusMode) && capabilities.focusMode.includes('continuous')) {
      advanced.focusMode = 'continuous';
    }
    if (Array.isArray(capabilities?.exposureMode) && capabilities.exposureMode.includes('continuous')) {
      advanced.exposureMode = 'continuous';
    }
    if (Array.isArray(capabilities?.whiteBalanceMode) && capabilities.whiteBalanceMode.includes('continuous')) {
      advanced.whiteBalanceMode = 'continuous';
    }
    if (Object.keys(advanced).length) {
      await track.applyConstraints({ advanced: [advanced] } as any);
    }
  } catch {}
}

function scanType(value: string) {
  if (/^https?:\/\//i.test(value)) return 'qr';
  if (/^\d{8,14}$/.test(value.replace(/[\s-]/g, ''))) return 'upc';
  return undefined;
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
    if (formats.length && decodeHintType.POSSIBLE_FORMATS !== undefined) {
      hints.set(decodeHintType.POSSIBLE_FORMATS, formats);
    }
    if (decodeHintType.TRY_HARDER !== undefined) hints.set(decodeHintType.TRY_HARDER, true);
    if (decodeHintType.ALSO_INVERTED !== undefined) hints.set(decodeHintType.ALSO_INVERTED, true);
    return new zxing.BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 80,
      delayBetweenScanSuccess: 250,
    });
  }

  const reader = new zxing.BrowserMultiFormatReader();
  if (formats.length) reader.possibleFormats = formats;
  return reader;
}

export default function MapScannerSearchPlacement() {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [unknownScan, setUnknownScan] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<any>(null);
  const resolvingRef = useRef(false);
  const startScannerRef = useRef<() => void>(() => undefined);

  const stopBrowserScanner = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    try { zxingControlsRef.current?.stop?.(); } catch {}
    zxingControlsRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerOpen(false);
  }, []);

  const resolveScannedValue = useCallback(async (raw: unknown) => {
    const value = String(raw || '').trim();
    if (!value || resolvingRef.current) return;

    resolvingRef.current = true;
    stopBrowserScanner();
    setUnknownScan(false);
    setStatusError(false);
    setStatusMessage('Looking up this product…');

    try {
      const type = scanType(value);
      const response = await fetch('/api/weedo-facts/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: value, type }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Product lookup failed.');

      const record = body?.record || null;
      const productId = String(record?.productId || body?.productId || '').trim();
      const batchId = String(record?.batchId || body?.batchId || '').trim();

      if (body?.found && productId) {
        setStatusMessage('Product found. Opening GeoWeedo Facts…');
        const productHref = `/product/${encodeURIComponent(productId)}${batchId ? `?batch=${encodeURIComponent(batchId)}` : ''}`;
        window.location.assign(productHref);
        return;
      }

      if (body?.found) {
        throw new Error('This scan resolved, but a public product page is not available yet.');
      }

      setUnknownScan(true);
      setStatusError(true);
      setStatusMessage('No GeoWeedo Facts record exists for this barcode or QR code yet.');
    } catch (error) {
      setStatusError(true);
      setStatusMessage(error instanceof Error ? error.message : 'Unable to look up this scan.');
    } finally {
      resolvingRef.current = false;
    }
  }, [stopBrowserScanner]);

  const startBrowserScanner = useCallback(async () => {
    setStatusMessage('');
    setStatusError(false);
    setUnknownScan(false);
    setScannerMessage('Starting rear camera…');

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusError(true);
      setStatusMessage('Camera access is not available in this browser.');
      return;
    }

    setScannerOpen(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    const video = videoRef.current;
    if (!video) {
      setScannerOpen(false);
      setStatusError(true);
      setStatusMessage('Camera preview could not start.');
      return;
    }

    let detectorStarted = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: scannerVideoConstraints, audio: false });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      await tuneScannerStream(stream);
      setScannerMessage('Point the camera at the code. GeoWeedo is using native detection + enhanced barcode decoding.');

      const BarcodeDetectorCtor = (window as any).BarcodeDetector;
      if (BarcodeDetectorCtor) {
        try {
          let detector: any;
          if (typeof BarcodeDetectorCtor.getSupportedFormats === 'function') {
            const supported = await BarcodeDetectorCtor.getSupportedFormats();
            const formats = browserFormats.filter(format => supported.includes(format));
            detector = formats.length ? new BarcodeDetectorCtor({ formats }) : new BarcodeDetectorCtor();
          } else {
            detector = new BarcodeDetectorCtor();
          }

          detectorStarted = true;
          let lastDetectionAt = 0;
          const detectFrame = async (time: number) => {
            if (resolvingRef.current || streamRef.current !== stream) return;
            if (time - lastDetectionAt >= 90 && video.readyState >= 2) {
              lastDetectionAt = time;
              try {
                const codes = await detector.detect(video);
                const hit = codes?.find((code: any) => code?.rawValue);
                if (hit?.rawValue) {
                  await resolveScannedValue(hit.rawValue);
                  return;
                }
              } catch {}
            }
            frameRef.current = requestAnimationFrame(detectFrame);
          };
          frameRef.current = requestAnimationFrame(detectFrame);
        } catch {
          detectorStarted = false;
        }
      }

      try {
        const zxing = await loadZxingBrowser();
        if (streamRef.current !== stream || resolvingRef.current) return;
        const reader = configureZxingReader(zxing);
        const controls = await reader.decodeFromVideoElement(video, (scanResult: any) => {
          const value = scanResult?.getText?.() || scanResult?.text;
          if (value) void resolveScannedValue(value);
        });
        zxingControlsRef.current = controls;
      } catch (zxingError) {
        if (!detectorStarted) throw zxingError;
      }
    } catch (error) {
      stopBrowserScanner();
      setStatusError(true);
      setStatusMessage(error instanceof Error ? error.message : 'Camera scanner could not start.');
    }
  }, [resolveScannedValue, stopBrowserScanner]);

  const startDirectScanner = useCallback(async () => {
    if (resolvingRef.current || scannerOpen) return;
    setStatusMessage('');
    setStatusError(false);
    setUnknownScan(false);

    if (!isNativeApp()) {
      await startBrowserScanner();
      return;
    }

    try {
      const result = await scanWeedoFactsCode();
      await resolveScannedValue(result.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      if (!/cancel/i.test(message)) {
        setStatusError(true);
        setStatusMessage(message || 'Unable to start the product scanner.');
      }
    }
  }, [resolveScannedValue, scannerOpen, startBrowserScanner]);

  startScannerRef.current = () => { void startDirectScanner(); };

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-geoweedo-map-scanner]')
        : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      startScannerRef.current();
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  useEffect(() => () => stopBrowserScanner(), [stopBrowserScanner]);

  useLayoutEffect(() => {
    let scanner: HTMLElement | null = null;
    let originalParent: Node | null = null;
    let originalNextSibling: ChildNode | null = null;
    let originalScannerStyle: string | null = null;
    let input: HTMLInputElement | null = null;
    let originalInputPaddingRight = '';
    let clearButton: HTMLButtonElement | null = null;
    let originalClearStyle: string | null = null;

    const placeScanner = () => {
      const search = document.querySelector<HTMLElement>('.map-first-home .map-unified-search');
      if (!search) return;

      const found = document.querySelector<HTMLElement>('[data-geoweedo-map-scanner]');
      if (found && found !== scanner) {
        scanner = found;
        originalParent = found.parentNode;
        originalNextSibling = found.nextSibling;
        originalScannerStyle = found.getAttribute('style');
      }
      if (!scanner) return;

      if (scanner.parentElement !== search) search.appendChild(scanner);
      search.dataset.mapScannerEmbedded = '1';
      search.style.position = 'relative';

      const nextInput = search.querySelector<HTMLInputElement>('.map-unified-search-input');
      if (nextInput && nextInput !== input) {
        input = nextInput;
        originalInputPaddingRight = nextInput.style.paddingRight;
      }
      if (input) input.style.paddingRight = '52px';

      const nextClear = search.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]');
      if (nextClear && nextClear !== clearButton) {
        clearButton = nextClear;
        originalClearStyle = nextClear.getAttribute('style');
      }
      if (clearButton) {
        clearButton.style.position = 'absolute';
        clearButton.style.right = '43px';
        clearButton.style.top = '50%';
        clearButton.style.transform = 'translateY(-50%)';
        clearButton.style.zIndex = '4';
      }

      Object.assign(scanner.style, {
        position: 'absolute',
        right: '4px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '34px',
        height: '34px',
        minWidth: '34px',
        minHeight: '34px',
        margin: '0',
        padding: '0',
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        cursor: 'pointer',
        zIndex: '5',
      });
    };

    placeScanner();
    const observer = new MutationObserver(placeScanner);
    observer.observe(document.body, { subtree: true, childList: true });

    return () => {
      observer.disconnect();
      const search = document.querySelector<HTMLElement>('.map-first-home .map-unified-search');
      search?.removeAttribute('data-map-scanner-embedded');

      if (input) input.style.paddingRight = originalInputPaddingRight;
      if (clearButton) {
        if (originalClearStyle === null) clearButton.removeAttribute('style');
        else clearButton.setAttribute('style', originalClearStyle);
      }
      if (scanner) {
        if (originalScannerStyle === null) scanner.removeAttribute('style');
        else scanner.setAttribute('style', originalScannerStyle);

        if (originalParent) {
          if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
            originalParent.insertBefore(scanner, originalNextSibling);
          } else {
            originalParent.appendChild(scanner);
          }
        }
      }
    };
  }, []);

  return (
    <>
      {scannerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Scan a product barcode or QR code"
          style={{position:'fixed',inset:0,zIndex:10000,display:'grid',placeItems:'center',padding:16,background:'rgba(3,8,5,.82)',backdropFilter:'blur(7px)'}}
        >
          <div style={{width:'min(560px,100%)',border:'1px solid rgba(126,217,87,.3)',borderRadius:20,background:'#09150d',boxShadow:'0 28px 80px rgba(0,0,0,.55)',overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'14px 16px',borderBottom:'1px solid rgba(255,255,255,.09)'}}>
              <div><strong style={{display:'block',color:'#f2f8f2'}}>Scan product</strong><small style={{color:'rgba(226,238,228,.65)'}}>QR · UPC · EAN · retail barcode</small></div>
              <button type="button" onClick={stopBrowserScanner} aria-label="Close scanner" style={{width:38,height:38,border:'1px solid rgba(255,255,255,.12)',borderRadius:'50%',background:'rgba(255,255,255,.06)',color:'#fff',fontSize:22,cursor:'pointer'}}>×</button>
            </div>
            <div style={{position:'relative',margin:16,borderRadius:16,overflow:'hidden',background:'#020503',aspectRatio:'4 / 3'}}>
              <video ref={videoRef} playsInline muted style={{display:'block',width:'100%',height:'100%',objectFit:'cover'}} />
              <div aria-hidden="true" style={{position:'absolute',inset:'13% 8%',border:'2px solid rgba(126,217,87,.92)',borderRadius:14,boxShadow:'0 0 0 999px rgba(0,0,0,.22)',pointerEvents:'none'}} />
            </div>
            <p style={{margin:'0 16px 16px',color:'rgba(226,238,228,.78)',fontSize:13,lineHeight:1.45,textAlign:'center'}}>{scannerMessage}</p>
          </div>
        </div>
      ) : null}

      {statusMessage && !scannerOpen ? (
        <div role={statusError ? 'alert' : 'status'} style={{position:'fixed',left:'50%',bottom:22,transform:'translateX(-50%)',zIndex:9999,width:'min(520px,calc(100% - 28px))',padding:'13px 15px',border:`1px solid ${statusError?'rgba(255,190,110,.35)':'rgba(126,217,87,.35)'}`,borderRadius:14,background:'rgba(7,16,9,.97)',boxShadow:'0 16px 48px rgba(0,0,0,.42)',color:'#eef7ef',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:800,lineHeight:1.45}}>{statusMessage}</div>
          <div style={{display:'flex',justifyContent:'center',gap:8,marginTop:10,flexWrap:'wrap'}}>
            {unknownScan ? <a href="/geoweedo-facts" style={{padding:'8px 11px',borderRadius:9,background:'#7ed957',color:'#071108',fontSize:12,fontWeight:900,textDecoration:'none'}}>Open GeoWeedo Facts</a> : null}
            {statusError ? <button type="button" onClick={()=>{setStatusMessage('');setStatusError(false);setUnknownScan(false);}} style={{padding:'8px 11px',border:'1px solid rgba(255,255,255,.12)',borderRadius:9,background:'rgba(255,255,255,.05)',color:'#eef7ef',fontSize:12,fontWeight:800,cursor:'pointer'}}>Dismiss</button> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
