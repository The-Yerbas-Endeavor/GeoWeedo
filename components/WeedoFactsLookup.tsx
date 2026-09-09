'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type LookupResult = any;
type IdentifierType = 'qr' | 'upc' | 'uid' | 'batch' | 'coa' | 'unknown';

export default function WeedoFactsLookup() {
  const [identifier, setIdentifier] = useState('');
  const [identifierType, setIdentifierType] = useState<IdentifierType>('unknown');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMessage, setCameraMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);

  useEffect(() => () => stopCamera(), []);

  function stopCamera() {
    scanningRef.current = false;
    for (const track of streamRef.current?.getTracks() || []) track.stop();
    streamRef.current = null;
    setCameraOpen(false);
  }

  async function resolveValue(value: string, type?: IdentifierType) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setIdentifier(trimmed);
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/weedo-facts/resolve-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: trimmed, type }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Lookup failed');
      setIdentifierType(body.identifierType || type || 'unknown');
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
    await resolveValue(identifier);
  }

  async function startCamera() {
    setError('');
    setCameraMessage('');
    const BarcodeDetectorCtor = (window as any).BarcodeDetector;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage('Camera access is not available in this browser. Paste the QR, UPC, UID, batch, or COA below instead.');
      return;
    }
    if (!BarcodeDetectorCtor) {
      setCameraMessage('This browser does not provide built-in barcode detection yet. Camera scanning works in supported mobile browsers; manual lookup remains available below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      scanningRef.current = true;

      requestAnimationFrame(async () => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        let formats: string[] = [];
        try {
          const supported = typeof BarcodeDetectorCtor.getSupportedFormats === 'function'
            ? await BarcodeDetectorCtor.getSupportedFormats()
            : [];
          const preferred = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
          formats = preferred.filter((format) => supported.includes(format));
        } catch {}
        const detector = formats.length ? new BarcodeDetectorCtor({ formats }) : new BarcodeDetectorCtor();

        const detect = async () => {
          if (!scanningRef.current || !videoRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            const rawValue = barcodes?.[0]?.rawValue?.trim();
            if (rawValue) {
              const format = String(barcodes[0]?.format || '');
              const type: IdentifierType = format === 'qr_code' ? 'qr' : 'upc';
              stopCamera();
              await resolveValue(rawValue, type);
              return;
            }
          } catch {}
          if (scanningRef.current) window.setTimeout(detect, 250);
        };
        detect();
      });
    } catch (err) {
      stopCamera();
      setCameraMessage(err instanceof Error ? `Camera unavailable: ${err.message}` : 'Camera unavailable.');
    }
  }

  return (
    <div className="weedoFactsLookup">
      <div className="weedoFactsScanPanel">
        <div>
          <span className="weedoFactsEyebrow">SCAN WEEDO</span>
          <h2>Point your camera at the package</h2>
          <p>GeoWeedo can read supported QR codes and product barcodes. SC Labs PhytoFacts QR links are resolved directly into verified batch data when available.</p>
        </div>
        <div className="weedoFactsScanActions">
          {!cameraOpen ? <button type="button" className="weedoFactsScanButton" onClick={startCamera}>📷 Scan with camera</button> : null}
          {cameraOpen ? <button type="button" className="weedoFactsSecondaryButton" onClick={stopCamera}>Stop camera</button> : null}
        </div>
      </div>

      {cameraOpen ? (
        <div className="weedoFactsCameraWrap">
          <video ref={videoRef} className="weedoFactsCamera" muted playsInline />
          <div className="weedoFactsReticle" aria-hidden="true" />
          <p>Hold the QR code or barcode inside the frame.</p>
        </div>
      ) : null}
      {cameraMessage ? <p className="weedoFactsCameraMessage">{cameraMessage}</p> : null}

      <form onSubmit={submit} className="weedoFactsLookupForm">
        <label htmlFor="weedo-facts-identifier">Or enter a QR URL, UPC, UID, batch, or COA identifier</label>
        <div className="weedoFactsLookupRow">
          <input
            id="weedo-facts-identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Paste or type an identifier"
            autoComplete="off"
          />
          <button type="submit" disabled={loading}>{loading ? 'Checking…' : 'Look up'}</button>
        </div>
      </form>

      {error ? <p className="weedoFactsError">{error}</p> : null}

      {result?.found === false ? (
        <div className="weedoFactsEmpty">
          <strong>No Weedo Facts record yet.</strong>
          <p>GeoWeedo has not matched this scan to a verified product or exact batch. You can contribute the package details below for review.</p>
          <UnknownContribution identifier={identifier} identifierType={identifierType} />
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');

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
      <div className="weedoFactsContributionGrid">
        <label>Brand<input value={brandName} onChange={(event) => setBrandName(event.target.value)} /></label>
        <label>Product name<input value={productName} onChange={(event) => setProductName(event.target.value)} required /></label>
        <label>Batch / lot<input value={batchNumber} onChange={(event) => setBatchNumber(event.target.value)} /></label>
        <label>COA URL<input value={coaUrl} onChange={(event) => setCoaUrl(event.target.value)} placeholder="https://…" /></label>
      </div>
      <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Anything visible on the package that may help verify this product or batch" /></label>
      <button type="submit" disabled={saving || !productName.trim()}>{saving ? 'Submitting…' : 'Submit for review'}</button>
      {saveError ? <p className="weedoFactsError">{saveError} {saveError.startsWith('Login required') ? <a href="/account">Log in or create an account</a> : null}</p> : null}
      {message ? <p className="weedoFactsSuccess">{message}</p> : null}
    </form>
  );
}

function FactsCard({ record }: { record: any }) {
  const exact = record.matchLevel === 'exact_batch';
  const overall = String(record.overallStatus || '').trim();
  const failed = /^(fail|failed)$/i.test(overall);
  return (
    <article className="weedoFactsCard">
      <div className="weedoFactsCardHead">
        <div>
          <span className="weedoFactsEyebrow">WEEDO FACTS</span>
          <h2>{record.productName}</h2>
          <p>{[record.brandName, record.productType, record.netContents].filter(Boolean).join(' · ')}</p>
        </div>
        <span className={`weedoFactsStatus ${exact && !failed ? 'verified' : 'partial'}`}>
          {failed ? '⚠ Lab-reported batch failure' : exact ? '✓ Exact batch verified' : record.matchLevel === 'product_only' ? 'Product match — batch needed' : 'Community record — unverified'}
        </span>
      </div>

      {record.cannabinoids?.length ? <FactsSection title="Cannabinoids" rows={record.cannabinoids} /> : null}
      {record.terpenes?.length ? <FactsSection title="Terpenes" rows={record.terpenes} /> : null}

      {(overall || record.safetyTests?.length) ? (
        <section>
          <h3>Compliance testing</h3>
          <div className="weedoFactsRows">
            {overall ? <Fact label="Overall lab result" value={overall} /> : null}
            {record.safetyTests?.map((row: any, index: number) => (
              <div className="weedoFactsRow" key={`${row.category}-${row.analyte}-${index}`}>
                <span>{row.analyte || row.category}</span>
                <strong>{row.status || formatMeasurement(row)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h3>Batch information</h3>
        <div className="weedoFactsRows">
          {record.batchNumber ? <Fact label="Batch / lot" value={record.batchNumber} /> : null}
          {record.uid ? <Fact label="California UID" value={record.uid} /> : null}
          {record.coaNumber ? <Fact label="COA" value={record.coaNumber} /> : null}
          {record.testedAt ? <Fact label="Tested" value={new Date(record.testedAt).toLocaleDateString()} /> : null}
          {record.labName ? <Fact label="Laboratory" value={record.labName} /> : null}
          {record.producerName ? <Fact label="Producer / manufacturer" value={record.producerName} /> : null}
        </div>
      </section>

      {record.coaUrl ? <a className="weedoFactsCoaLink" href={record.coaUrl} target="_blank" rel="noreferrer">View original COA ↗</a> : null}
    </article>
  );
}

function FactsSection({ title, rows }: { title: string; rows: any[] }) {
  return (
    <section>
      <h3>{title}</h3>
      <div className="weedoFactsRows">
        {rows.map((row, index) => <Fact key={`${row.name}-${index}`} label={row.name} value={formatMeasurement(row)} />)}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="weedoFactsRow"><span>{label}</span><strong>{value}</strong></div>;
}

function formatMeasurement(row: any) {
  if (row.value === null || row.value === undefined) return row.status || '—';
  return `${Number(row.value).toLocaleString(undefined, { maximumFractionDigits: 4 })}${row.unit ? ` ${row.unit}` : ''}`;
}
