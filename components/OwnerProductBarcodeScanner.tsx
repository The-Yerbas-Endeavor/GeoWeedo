'use client';

import { useEffect, useRef, useState } from 'react';
import PhotoBarcodeScanButton from '@/components/PhotoBarcodeScanButton';
import { isNativeApp, scanWeedoFactsCode, type WeedoFactsScanResult } from '@/lib/native';

type Props = {
  disabled?: boolean;
  onCode: (value: string) => Promise<void> | void;
  onError?: (message: string) => void;
};

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
      else reject(new Error('Compatible product scanner could not load.'));
    };
    if (existing) {
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => reject(new Error('Compatible product scanner could not load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.geoweedoZxing = '1';
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Compatible product scanner could not load.')), { once: true });
    document.head.appendChild(script);
  });
  return zxingLoader;
}

const browserFormats = [
  'qr_code','data_matrix','ean_13','ean_8','upc_a','upc_e',
  'code_128','code_39','code_93','itf','codabar','pdf417','aztec',
];

function configureZxingReader(zxing: any) {
  const barcodeFormat = zxing?.BarcodeFormat;
  const decodeHintType = zxing?.DecodeHintType;
  const formats = barcodeFormat ? [
    barcodeFormat.QR_CODE,barcodeFormat.DATA_MATRIX,barcodeFormat.UPC_A,barcodeFormat.UPC_E,
    barcodeFormat.EAN_13,barcodeFormat.EAN_8,barcodeFormat.CODE_128,barcodeFormat.CODE_39,
    barcodeFormat.CODE_93,barcodeFormat.ITF,barcodeFormat.CODABAR,barcodeFormat.PDF_417,
    barcodeFormat.AZTEC,
  ].filter((format: unknown) => format !== undefined && format !== null) : [];

  if (decodeHintType && typeof Map !== 'undefined') {
    const hints = new Map<any,any>();
    if (formats.length && decodeHintType.POSSIBLE_FORMATS !== undefined) hints.set(decodeHintType.POSSIBLE_FORMATS, formats);
    if (decodeHintType.TRY_HARDER !== undefined) hints.set(decodeHintType.TRY_HARDER, true);
    if (decodeHintType.ALSO_INVERTED !== undefined) hints.set(decodeHintType.ALSO_INVERTED, true);
    return new zxing.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80, delayBetweenScanSuccess: 250 });
  }
  return new zxing.BrowserMultiFormatReader();
}

async function tuneStream(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  try {
    const capabilities = (track as any).getCapabilities?.() || {};
    const advanced: Record<string,unknown> = {};
    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) advanced.focusMode = 'continuous';
    if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes('continuous')) advanced.exposureMode = 'continuous';
    if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes('continuous')) advanced.whiteBalanceMode = 'continuous';
    if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] } as any);
  } catch {}
}

export default function OwnerProductBarcodeScanner({ disabled=false, onCode, onError }: Props) {
  const [open,setOpen] = useState(false);
  const [pending,setPending] = useState(false);
  const [message,setMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const controlsRef = useRef<any>(null);
  const frameRef = useRef<number|null>(null);
  const deliveredRef = useRef(false);

  useEffect(() => () => stop(), []);

  function stop() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    try { controlsRef.current?.stop?.(); } catch {}
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setOpen(false);
    setPending(false);
  }

  async function deliver(result: WeedoFactsScanResult | string) {
    if (deliveredRef.current) return;
    const value = typeof result === 'string' ? result.trim() : String(result.value || '').trim();
    if (!value) return;
    deliveredRef.current = true;
    stop();
    try {
      await onCode(value);
    } finally {
      window.setTimeout(() => { deliveredRef.current = false; }, 250);
    }
  }

  async function start() {
    if (disabled || pending) return;
    setMessage('');
    onError?.('');
    deliveredRef.current = false;

    if (isNativeApp()) {
      setPending(true);
      try {
        await deliver(await scanWeedoFactsCode());
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Scanner could not start.';
        if (!/cancel/i.test(text)) onError?.(text);
        setPending(false);
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      onError?.('Camera scanning is not available in this browser. Use “Scan from photo” instead.');
      return;
    }

    setOpen(true);
    setPending(true);
    setMessage('Starting rear camera…');
    await new Promise(resolve => setTimeout(resolve,0));
    const video = videoRef.current;
    if (!video) {
      stop();
      onError?.('Camera preview could not start.');
      return;
    }

    let nativeDetectorRunning = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:60}},
        audio:false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      await tuneStream(stream);
      setMessage('Hold the barcode or QR code inside the frame.');

      const BarcodeDetectorCtor = (window as any).BarcodeDetector;
      if (BarcodeDetectorCtor) {
        try {
          let detector:any;
          if (typeof BarcodeDetectorCtor.getSupportedFormats === 'function') {
            const supported = await BarcodeDetectorCtor.getSupportedFormats();
            const formats = browserFormats.filter(format => supported.includes(format));
            detector = formats.length ? new BarcodeDetectorCtor({formats}) : new BarcodeDetectorCtor();
          } else detector = new BarcodeDetectorCtor();
          nativeDetectorRunning = true;
          let last = 0;
          const detect = async (time:number) => {
            if (streamRef.current !== stream || deliveredRef.current) return;
            if (time-last >= 90 && video.readyState >= 2) {
              last=time;
              try {
                const codes=await detector.detect(video);
                const hit=codes?.find((code:any)=>String(code?.rawValue||'').trim());
                if (hit?.rawValue) { await deliver(String(hit.rawValue)); return; }
              } catch {}
            }
            frameRef.current=requestAnimationFrame(detect);
          };
          frameRef.current=requestAnimationFrame(detect);
        } catch { nativeDetectorRunning=false; }
      }

      try {
        const zxing = await loadZxingBrowser();
        if (streamRef.current !== stream || deliveredRef.current) return;
        const reader = configureZxingReader(zxing);
        controlsRef.current = await reader.decodeFromVideoElement(video,(scanResult:any)=>{
          const value=scanResult?.getText?.()||scanResult?.text;
          if (value) void deliver(String(value));
        });
      } catch (error) {
        if (!nativeDetectorRunning) throw error;
      }
    } catch (error) {
      stop();
      onError?.(error instanceof Error ? error.message : 'Camera scanner could not start.');
    } finally {
      if (streamRef.current) setPending(false);
    }
  }

  return <div style={{display:'grid',gap:8}}>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button type="button" className="owner-primary" style={{width:'auto'}} onClick={()=>void start()} disabled={disabled||pending}>
        {pending&&!open?'Opening camera…':'📷 Scan barcode / QR'}
      </button>
      <PhotoBarcodeScanButton
        onScan={deliver}
        onError={message=>onError?.(message)}
        disabled={disabled}
        label="🖼️ Scan from photo"
        style={{border:'1px solid var(--border)',borderRadius:10,background:'rgba(255,255,255,.03)',color:'inherit',padding:'9px 12px',fontWeight:800,cursor:'pointer'}}
      />
    </div>
    {open?<div style={{border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',background:'#050806'}}>
      <div style={{position:'relative',aspectRatio:'4 / 3'}}>
        <video ref={videoRef} playsInline muted style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
        <div aria-hidden="true" style={{position:'absolute',inset:'22%',border:'2px solid rgba(154,237,121,.95)',borderRadius:14,boxShadow:'0 0 0 999px rgba(0,0,0,.28)'}}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',padding:'9px 10px'}}>
        <small style={{color:'var(--muted)'}}>{message}</small>
        <button type="button" onClick={stop}>Cancel</button>
      </div>
    </div>:null}
  </div>;
}
