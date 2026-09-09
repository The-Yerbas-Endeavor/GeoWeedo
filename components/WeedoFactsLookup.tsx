'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type LookupResult = any;

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

  useEffect(() => () => stopScanner(), []);

  function stopScanner() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
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

  async function startScanner() {
    setError('');
    setScannerMessage('Starting camera…');
    const BarcodeDetectorCtor = (window as any).BarcodeDetector;
    if (!BarcodeDetectorCtor) {
      setError('This browser does not support live barcode detection yet. Paste the QR URL, UPC, UID, batch, or COA number instead.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this browser.');
      return;
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
            const value = String(hit.rawValue).trim();
            const type = /^https?:\/\//i.test(value) ? 'qr' : /^\d{8,14}$/.test(value) ? 'upc' : undefined;
            stopScanner();
            await resolveIdentifier(value, type);
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
        <span>QR codes and UPC/EAN barcodes are supported when the browser provides BarcodeDetector.</span>
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
      {result?.found === false ? <div className="weedoFactsEmpty"><strong>No Weedo Facts record yet.</strong><p>Try the package lab QR, batch/lot, UID, or original COA. Community contribution support is available for products GeoWeedo does not know yet.</p></div> : null}
      {result?.found && result.record ? <FactsCard record={result.record} /> : null}
    </div>
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
    </article>
  );
}

function FactsSection({ title, rows }: { title: string; rows: any[] }) { return <section><h3>{title}</h3><div className="weedoFactsRows">{rows.map((row, index) => <Fact key={`${row.name}-${index}`} label={row.name} value={formatMeasurement(row)} />)}</div></section>; }
function Fact({ label, value }: { label: string; value: string }) { return <div className="weedoFactsRow"><span>{label}</span><strong>{value}</strong></div>; }
function formatMeasurement(row: any) { if (row.value === null || row.value === undefined) return row.status || '—'; return `${Number(row.value).toLocaleString(undefined, { maximumFractionDigits: 4 })}${row.unit ? ` ${row.unit}` : ''}`; }
