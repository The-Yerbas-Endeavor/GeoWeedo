'use client';

import { useRef, useState } from 'react';

type ReconstructionResult = any;

let tesseractLoader: Promise<any> | null = null;

function loadTesseract() {
  const current = (window as any).Tesseract;
  if (current?.recognize || current?.createWorker) return Promise.resolve(current);
  if (tesseractLoader) return tesseractLoader;

  tesseractLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-geoweedo-tesseract]');
    const finish = () => {
      const api = (window as any).Tesseract;
      if (api?.recognize || api?.createWorker) resolve(api);
      else reject(new Error('Label reader could not load.'));
    };
    if (existing) {
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => reject(new Error('Label reader could not load.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.geoweedoTesseract = '1';
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Label reader could not load.')), { once: true });
    document.head.appendChild(script);
  });

  return tesseractLoader;
}

function currentBarcode() {
  const input = document.getElementById('weedo-facts-identifier') as HTMLInputElement | null;
  return String(input?.value || '').replace(/\D/g, '');
}

function confidenceLabel(value: string) {
  if (value === 'strong_product_match') return 'STRONG PRODUCT MATCH';
  if (value === 'possible_product_match') return 'POSSIBLE PRODUCT MATCH';
  return 'NO CONFIDENT MATCH';
}

function evidenceRows(evidence: any) {
  return [
    ['UPC / EAN', evidence?.upc],
    ['Product', evidence?.productName],
    ['Manufacturer', evidence?.manufacturer],
    ['Batch / lot', evidence?.batchNumber],
    ['UID', evidence?.uid],
    ['Phone', evidence?.phone],
    ['THC', evidence?.thcPercent !== null && evidence?.thcPercent !== undefined ? `${evidence.thcPercent}%${evidence.thcMg ? ` / ${evidence.thcMg} mg` : ''}` : null],
    ['CBD', evidence?.cbdPercent !== null && evidence?.cbdPercent !== undefined ? `${evidence.cbdPercent}%${evidence.cbdMg ? ` / ${evidence.cbdMg} mg` : ''}` : null],
    ['Product form', evidence?.productType],
    ['Label category', evidence?.cultivarType],
  ].filter(([, value]) => Boolean(value));
}

async function prepareLabelImage(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const targetLongest = Math.min(2400, Math.max(1600, longest));
    const scale = targetLongest / longest;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Label image could not be prepared.');
    context.drawImage(bitmap, 0, 0, width, height);

    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    let min = 255;
    let max = 0;
    const grayscale = new Uint8Array(width * height);
    for (let pixel = 0, index = 0; pixel < data.length; pixel += 4, index += 1) {
      const gray = Math.round(data[pixel] * 0.299 + data[pixel + 1] * 0.587 + data[pixel + 2] * 0.114);
      grayscale[index] = gray;
      if (gray < min) min = gray;
      if (gray > max) max = gray;
    }
    const range = Math.max(48, max - min);
    for (let pixel = 0, index = 0; pixel < data.length; pixel += 4, index += 1) {
      const stretched = Math.max(0, Math.min(255, Math.round(((grayscale[index] - min) * 255) / range)));
      data[pixel] = stretched;
      data[pixel + 1] = stretched;
      data[pixel + 2] = stretched;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  } finally {
    bitmap.close?.();
  }
}

function assessLabelText(text: string) {
  const trimmed = text.trim();
  const nonSpace = trimmed.replace(/\s/g, '');
  const alphaNumeric = trimmed.match(/[A-Za-z0-9]/g)?.length || 0;
  const words = trimmed.match(/[A-Za-z][A-Za-z0-9'&-]{2,}/g) || [];
  const anchors = trimmed.match(/\b(?:thc|cbd|cannabis|batch|lot|uid|manufacturer|manufactured|mfg|license|lic|mg|gram|grams|flower|cartridge|vape|resin|rosin|indica|sativa|hybrid)\b/gi) || [];
  const readableRatio = nonSpace.length ? alphaNumeric / nonSpace.length : 0;
  const useful = alphaNumeric >= 24 && words.length >= 3 && readableRatio >= 0.58 && anchors.length >= 1;
  return { useful, readableRatio, words: words.length, anchors: anchors.length };
}

async function recognizeLabel(tesseract: any, image: HTMLCanvasElement, onProgress: (progress: number) => void) {
  if (typeof tesseract.createWorker === 'function') {
    const worker = await tesseract.createWorker('eng', undefined, {
      logger: (event: any) => {
        if (event?.status === 'recognizing text' && Number.isFinite(event?.progress)) onProgress(event.progress);
      },
    });
    try {
      await worker.setParameters?.({
        tessedit_pageseg_mode: String(tesseract?.PSM?.SPARSE_TEXT ?? 11),
        preserve_interword_spaces: '1',
      });
      return await worker.recognize(image);
    } finally {
      await worker.terminate?.();
    }
  }

  return tesseract.recognize(image, 'eng', {
    logger: (event: any) => {
      if (event?.status === 'recognizing text' && Number.isFinite(event?.progress)) onProgress(event.progress);
    },
  });
}

export default function WeedoFactsReconstruction() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [upc, setUpc] = useState('');
  const [labelText, setLabelText] = useState('');
  const [result, setResult] = useState<ReconstructionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function start() {
    setError('');
    setMessage('');
    const scanned = currentBarcode();
    if (!/^\d{8,14}$/.test(scanned)) {
      setError('Scan or enter a UPC/EAN barcode above first.');
      return;
    }
    setUpc(scanned);

    try {
      const response = await fetch(`/api/weedo-facts/reconstruct?upc=${encodeURIComponent(scanned)}`, { cache: 'no-store' });
      const body = await response.json();
      if (response.ok && body?.found && body?.reconstruction) {
        setResult(body.reconstruction);
        setLabelText('');
        setMessage('GeoWeedo already has a saved public-source reconstruction for this barcode.');
        return;
      }
    } catch {}

    fileRef.current?.click();
  }

  async function processLabelPhoto(file: File) {
    const scanned = upc || currentBarcode();
    if (!/^\d{8,14}$/.test(scanned)) {
      setError('Scan or enter a UPC/EAN barcode above first.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('Preparing product label on this device…');
    setResult(null);

    try {
      const [tesseract, prepared] = await Promise.all([loadTesseract(), prepareLabelImage(file)]);
      const ocr = await recognizeLabel(tesseract, prepared, progress => {
        setMessage(`Reading product label… ${Math.round(progress * 100)}%`);
      });
      const text = String(ocr?.data?.text || '').trim();
      setLabelText(text);

      if (text.length < 8) {
        throw new Error('GeoWeedo could not read enough text from that label. Move closer so the printed label fills the photo, keep the text horizontal, and avoid glare.');
      }

      const quality = assessLabelText(text);
      if (!quality.useful) {
        setMessage('');
        setError('GeoWeedo read the photo, but the text is too noisy to use for product reconstruction. Retake it closer with the label filling most of the frame, text horizontal, good focus, and minimal glare. You can also correct the recognized text below and re-run reconstruction.');
        return;
      }

      await reconstruct(scanned, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Product label reconstruction failed.');
      setMessage('');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function reconstruct(barcode = upc || currentBarcode(), text = labelText) {
    const normalized = String(barcode || '').replace(/\D/g, '');
    if (!/^\d{8,14}$/.test(normalized)) {
      setError('Scan or enter a UPC/EAN barcode above first.');
      return;
    }
    if (text.trim().length < 8) {
      setError('Recognized label text is required.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('Comparing label evidence with public cannabis product sources…');
    setResult(null);

    try {
      const response = await fetch('/api/weedo-facts/reconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upc: normalized, labelText: text }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Product reconstruction failed.');
      setUpc(normalized);
      setResult(body.reconstruction || null);
      setMessage(body?.reconstruction?.cached ? 'Loaded saved reconstruction.' : 'Public-source reconstruction complete.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Product reconstruction failed.');
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  const evidence = result?.evidence;
  const rows = evidenceRows(evidence);
  const candidates = Array.isArray(result?.candidates) ? result.candidates.slice(0, 5) : [];

  return (
    <section className="weedoFactsReconstruction">
      <div className="weedoFactsReconstructionHead">
        <div>
          <span className="weedoFactsEyebrow">UNKNOWN BARCODE RECOVERY</span>
          <h2>Reconstruct an unlisted cannabis product</h2>
          <p>If the barcode is valid but GeoWeedo has no listing, photograph the printed package label. Fill most of the frame with the label, keep the text horizontal, and avoid glare. GeoWeedo reads the label locally, then compares useful product, batch, manufacturer and potency evidence with public sources.</p>
        </div>
        <button type="button" className="weedoFactsScanButton" onClick={start} disabled={busy}>{busy ? 'Working…' : '📷 Scan product label'}</button>
      </div>

      <input
        ref={fileRef}
        className="weedoFactsHiddenCapture"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void processLabelPhoto(file);
        }}
      />

      <p className="weedoFactsReconstructionPrivacy">The label photo is OCR-read in the browser. GeoWeedo sends recognized text and the barcode to its reconstruction API; the photo itself is not uploaded.</p>

      {message ? <p className="weedoFactsSuccess">{message}</p> : null}
      {error ? <p className="weedoFactsError">{error}</p> : null}

      {labelText ? (
        <div className="weedoFactsRecognizedText">
          <label htmlFor="weedo-facts-label-text">Recognized label text</label>
          <textarea id="weedo-facts-label-text" value={labelText} onChange={(event) => setLabelText(event.target.value)} rows={7} />
          <button type="button" onClick={() => void reconstruct()} disabled={busy}>Re-run reconstruction</button>
        </div>
      ) : null}

      {result ? (
        <div className="weedoFactsReconstructionResult">
          <div className="weedoFactsReconstructionStatus">
            <strong>{confidenceLabel(result.confidence)}</strong>
            <span>Evidence score {result.score ?? 0}/100</span>
          </div>

          {rows.length ? (
            <div className="weedoFactsReconstructionEvidence">
              {rows.map(([label, value]) => (
                <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
          ) : null}

          {result.bestMatch ? (
            <div className="weedoFactsReconstructionBest">
              <span>Best public match</span>
              <a href={result.bestMatch.url} target="_blank" rel="noreferrer">{result.bestMatch.title || result.bestMatch.sourceHost}</a>
              {result.bestMatch.snippet ? <p>{result.bestMatch.snippet}</p> : null}
              {Array.isArray(result.bestMatch.reasons) && result.bestMatch.reasons.length ? (
                <ul>{result.bestMatch.reasons.map((reason: string) => <li key={reason}>{reason}</li>)}</ul>
              ) : null}
            </div>
          ) : <p>No public result scored strongly enough yet. Correct the recognized text above and try again, or use a COA/UID if available.</p>}

          {candidates.length > 1 ? (
            <details className="weedoFactsReconstructionSources">
              <summary>Supporting public results ({candidates.length})</summary>
              <div>
                {candidates.map((candidate: any) => (
                  <a key={candidate.url} href={candidate.url} target="_blank" rel="noreferrer">
                    <strong>{candidate.title || candidate.sourceHost}</strong>
                    <span>{candidate.sourceHost} · score {candidate.score}</span>
                  </a>
                ))}
              </div>
            </details>
          ) : null}

          <p className="weedoFactsReconstructionNotice">{result.notice || 'This reconstruction is public-source evidence, not verification of the exact laboratory batch.'}</p>
        </div>
      ) : null}
    </section>
  );
}
