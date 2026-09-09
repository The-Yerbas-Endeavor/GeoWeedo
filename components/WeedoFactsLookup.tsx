'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import WeedoFactsBatchHistory from '@/components/WeedoFactsBatchHistory';

type LookupResult = any;
type IdentifierType = 'qr' | 'upc' | 'uid' | 'batch' | 'coa' | 'unknown';

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

function inferIdentifierType(value: string): IdentifierType {
  if (/^https?:\/\//i.test(value)) return 'qr';
  if (/^\d{8,14}$/.test(value.replace(/[\s-]/g, ''))) return 'upc';
  return 'unknown';
}

export default function WeedoFactsLookup() {
  const [identifier, setIdentifier] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<any>(null);

  useEffect(() => () => stopScanner(), []);

  function stopScanner() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    try { zxingControlsRef.current?.stop?.(); } catch {}
    zxingControlsRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerOpen(false);
  }

  async function resolveIdentifier(value: string, type?: string) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/weedo-facts/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: value, type }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Lookup failed');
      setIdentifier(value);
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = identifier.trim();
    if (value) await resolveIdentifier(value);
  }

  async function handleScannedValue(raw: unknown) {
    const value = String(raw || '').trim();
    if (!value) return;
    const type = /^https?:\/\//i.test(value) ? 'qr' : /^\d{8,14}$/.test(value) ? 'upc' : undefined;
    stopScanner();
    await resolveIdentifier(value, type);
  }

  async function startScanner() {
    setError('');
    setScannerMessage('Starting camera…');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this browser.');
      return;
    }

    const BarcodeDetectorCtor = (window as any).BarcodeDetector;
    if (!BarcodeDetectorCtor) {
      try {
        setScannerMessage('Loading compatible scanner…');
        const zxing = await loadZxingBrowser();
        setScannerOpen(true);
        await new Promise(resolve => setTimeout(resolve, 0));
        const video = videoRef.current;
        if (!video) throw new Error('Camera preview could not start.');
        setScannerMessage('Point the camera at a QR code or product barcode.');
        const reader = new zxing.BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoDevice(undefined, video, (scanResult: any) => {
          const value = scanResult?.getText?.() || scanResult?.text;
          if (value) void handleScannedValue(value);
        });
        zxingControlsRef.current = controls;
        return;
      } catch (err) {
        stopScanner();
        setError(err instanceof Error ? err.message : 'Compatible barcode scanner could not start.');
        return;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      setScannerOpen(true);
      setScannerMessage('Point the camera at a QR code or product barcode.');
      await new Promise(resolve => setTimeout(resolve, 0));
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview could not start.');
      video.srcObject = stream;
      await video.play();
      const detector = new BarcodeDetectorCtor();

      const scan = async () => {
        try {
          const codes = await detector.detect(video);
          const hit = codes?.find((code: any) => code?.rawValue);
          if (hit?.rawValue) {
            await handleScannedValue(hit.rawValue);
            return;
          }
        } catch {}
        frameRef.current = requestAnimationFrame(scan);
      };
      frameRef.current = requestAnimationFrame(scan);
    } catch (err) {
      stopScanner();
      setError(err instanceof Error ? err.message : 'Camera access failed.');
    }
  }

  return (
    <div className="weedoFactsLookup">
      <div className="weedoFactsScanActions">
        <button type="button" className="weedoFactsScanButton" onClick={startScanner} disabled={loading || scannerOpen}>📷 Scan package</button>
        <span>Scan QR codes and UPC/EAN barcodes with the camera, including browsers without native BarcodeDetector support.</span>
      </div>

      {scannerOpen ? (
        <div className="weedoFactsScanner">
          <video ref={videoRef} playsInline muted />
          <div className="weedoFactsScannerOverlay"><span /></div>
          <p>{scannerMessage}</p>
          <button type="button" onClick={stopScanner}>Cancel camera</button>
        </div>
      ) : null}

      <form onSubmit={submit} className="weedoFactsLookupForm">
        <label htmlFor="weedo-facts-identifier">Product, batch, UID, barcode, QR URL, or COA identifier</label>
        <div className="weedoFactsLookupRow">
          <input id="weedo-facts-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Paste an identifier or scan the package" autoComplete="off" />
          <button type="submit" disabled={loading}>{loading ? 'Checking…' : 'Look up'}</button>
        </div>
      </form>

      {error ? <p className="weedoFactsError">{error}</p> : null}
      {result?.found === false ? (
        <div className="weedoFactsEmpty">
          <strong>No Weedo Facts record yet.</strong>
          <p>Try the package lab QR, batch/lot, UID, or original COA. If GeoWeedo still does not know it, upload the official SC Labs COA or submit the package details below for review.</p>
          <UnknownContribution identifier={identifier} identifierType={inferIdentifierType(identifier)} />
        </div>
      ) : null}
      {result?.found && result.record ? <FactsCard record={result.record} /> : null}
    </div>
  );
}

function UnknownContribution({ identifier, identifierType }: { identifier: string; identifierType: IdentifierType }) {
  const [brandName, setBrandName] = useState('');
  const [productName, setProductName] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [coaUrl, setCoaUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [coaFile, setCoaFile] = useState<File | null>(null);
  const [coaUploading, setCoaUploading] = useState(false);
  const [coaUploadId, setCoaUploadId] = useState('');
  const [coaParsed, setCoaParsed] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  async function uploadCoa() {
    if (!coaFile) return;
    setCoaUploading(true);
    setMessage('');
    setSaveError('');
    try {
      const form = new FormData();
      form.set('file', coaFile);
      form.set('identifierValue', identifier);
      form.set('identifierType', identifierType);
      const response = await fetch('/api/weedo-facts/coa-upload', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 401) throw new Error('Login required to upload an official COA.');
        throw new Error(body?.error || 'Unable to parse this COA PDF.');
      }
      setCoaUploadId(body.upload.id);
      setCoaParsed(body.parsed || null);
      if (!productName && body.parsed?.productName) setProductName(body.parsed.productName);
      if (!batchNumber && body.parsed?.batchNumber) setBatchNumber(body.parsed.batchNumber);
      setMessage(`COA parsed${body.parsed?.sampleId ? ` — sample ${body.parsed.sampleId}` : ''}. Review the details, then submit.`);
    } catch (err) {
      setCoaUploadId('');
      setCoaParsed(null);
      setSaveError(err instanceof Error ? err.message : 'Unable to parse this COA PDF.');
    } finally {
      setCoaUploading(false);
    }
  }

  async function submitContribution(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setSaveError('');
    try {
      const response = await fetch('/api/weedo-facts/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifierType,
          identifierValue: identifier,
          brandName,
          productName,
          batchNumber,
          coaUrl,
          coaUploadId: coaUploadId || undefined,
          sourceUrl: /^https?:\/\//i.test(identifier) ? identifier : undefined,
          notes,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 401) throw new Error('Login required to submit a new scan.');
        throw new Error(body?.error || 'Unable to submit this scan.');
      }
      setMessage(body?.message || 'Thanks — this scan was submitted for review.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to submit this scan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="weedoFactsContribution" onSubmit={submitContribution}>
      <h3>Add this scan to GeoWeedo</h3>
      <div className="weedoFactsCoaUpload">
        <div>
          <strong>Official SC Labs COA PDF</strong>
          <p>Upload the original certificate and GeoWeedo will parse its sample, batch, UID, lab status, cannabinoids and supported compliance results as review evidence.</p>
        </div>
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            setCoaFile(event.target.files?.[0] || null);
            setCoaUploadId('');
            setCoaParsed(null);
          }}
        />
        <button type="button" onClick={uploadCoa} disabled={!coaFile || coaUploading}>{coaUploading ? 'Parsing COA…' : coaUploadId ? 'COA attached ✓' : 'Upload & parse COA'}</button>
        {coaParsed ? (
          <div className="weedoFactsCoaParsed">
            {coaParsed.sampleId ? <span>Sample <strong>{coaParsed.sampleId}</strong></span> : null}
            {coaParsed.productName ? <span>Product <strong>{coaParsed.productName}</strong></span> : null}
            {coaParsed.batchNumber ? <span>Batch <strong>{coaParsed.batchNumber}</strong></span> : null}
            {coaParsed.uid ? <span>UID <strong>{coaParsed.uid}</strong></span> : null}
            {coaParsed.overallStatus ? <span>Lab result <strong>{coaParsed.overallStatus}</strong></span> : null}
            <span>Parsed analytes <strong>{coaParsed.analyteCount ?? 0}</strong></span>
          </div>
        ) : null}
      </div>

      <div className="weedoFactsContributionGrid">
        <label>Brand<input value={brandName} onChange={(event) => setBrandName(event.target.value)} /></label>
        <label>Product name<input value={productName} onChange={(event) => setProductName(event.target.value)} /></label>
        <label>Batch / lot<input value={batchNumber} onChange={(event) => setBatchNumber(event.target.value)} /></label>
        <label>COA URL<input value={coaUrl} onChange={(event) => setCoaUrl(event.target.value)} placeholder="https://…" /></label>
      </div>
      <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Anything visible on the package that may help verify this product or batch" /></label>
      <button type="submit" disabled={saving || (!productName.trim() && !coaUploadId)}>{saving ? 'Submitting…' : coaUploadId ? 'Submit scan + COA for review' : 'Submit for review'}</button>
      {saveError ? <p className="weedoFactsError">{saveError} {saveError.startsWith('Login required') ? <a href="/account">Log in or create an account</a> : null}</p> : null}
      {message ? <p className="weedoFactsSuccess">{message}</p> : null}
    </form>
  );
}

function FactsCard({ record }: { record: any }) {
  const exact = record.matchLevel === 'exact_batch';
  const statusText = String(record.overallStatus || '').trim();
  const failed = /fail/i.test(statusText);
  return (
    <article className="weedoFactsCard">
      <div className="weedoFactsCardHead">
        <div><span className="weedoFactsEyebrow">WEEDO FACTS</span><h2>{record.productName}</h2><p>{[record.brandName, record.productType, record.netContents].filter(Boolean).join(' · ')}</p></div>
        <span className={`weedoFactsStatus ${exact ? 'verified' : 'partial'}`}>{exact ? '✓ Exact batch verified' : record.matchLevel === 'product_only' ? 'Product match — batch needed' : 'Community record — unverified'}</span>
      </div>

      {statusText ? <div className={`weedoFactsOverallStatus ${failed ? 'failed' : 'reported'}`}><span>Lab-reported compliance status</span><strong>{statusText}</strong></div> : null}
      {record.cannabinoids?.length ? <FactsSection title="Cannabinoids" rows={record.cannabinoids} /> : null}
      {record.terpenes?.length ? <FactsSection title="Terpenes" rows={record.terpenes} /> : null}
      {record.safetyTests?.length ? <section><h3>Compliance testing</h3><div className="weedoFactsRows">{record.safetyTests.map((row: any, index: number) => <div className="weedoFactsRow" key={`${row.category}-${row.analyte}-${index}`}><span>{row.analyte || row.category}</span><strong>{row.status || formatMeasurement(row)}</strong></div>)}</div></section> : null}
      <section><h3>Batch information</h3><div className="weedoFactsRows">{record.batchNumber ? <Fact label="Batch / lot" value={record.batchNumber} /> : null}{record.uid ? <Fact label="California UID" value={record.uid} /> : null}{record.coaNumber ? <Fact label="COA" value={record.coaNumber} /> : null}{record.testedAt ? <Fact label="Tested" value={new Date(record.testedAt).toLocaleDateString()} /> : null}{record.labName ? <Fact label="Laboratory" value={record.labName} /> : null}{record.producerName ? <Fact label="Producer / manufacturer" value={record.producerName} /> : null}</div></section>
      {record.coaUrl ? <a className="weedoFactsCoaLink" href={record.coaUrl} target="_blank" rel="noreferrer">View original COA ↗</a> : null}
      {record.productId ? <WeedoFactsBatchHistory productId={record.productId} currentBatchId={record.batchId} /> : null}
    </article>
  );
}

function FactsSection({ title, rows }: { title: string; rows: any[] }) { return <section><h3>{title}</h3><div className="weedoFactsRows">{rows.map((row, index) => <Fact key={`${row.name}-${index}`} label={row.name} value={formatMeasurement(row)} />)}</div></section>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="weedoFactsRow"><span>{label}</span><strong>{value}</strong></div>; }
function formatMeasurement(row: any) { if (row.value === null || row.value === undefined) return row.status || '—'; return `${Number(row.value).toLocaleString(undefined, { maximumFractionDigits: 4 })}${row.unit ? ` ${row.unit}` : ''}`; }
