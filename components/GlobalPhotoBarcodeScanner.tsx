'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PhotoBarcodeScanButton from '@/components/PhotoBarcodeScanButton';
import { cancelNativeProductScanner, type WeedoFactsScanResult } from '@/lib/native';

type Targets = {
  facts: HTMLElement | null;
  owner: HTMLElement | null;
  mapDialog: HTMLElement | null;
  nativeControls: HTMLElement | null;
};

const emptyTargets: Targets = {
  facts: null,
  owner: null,
  mapDialog: null,
  nativeControls: null,
};

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function submitExistingLookup(input: HTMLInputElement | null, value: string): boolean {
  if (!input) return false;
  setInputValue(input, value);
  const form = input.closest('form');
  if (!form) return false;
  window.setTimeout(() => form.requestSubmit(), 0);
  return true;
}

function ownerScanInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[placeholder^="Or paste/type a QR URL"]');
}

function factsScanInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('#weedo-facts-identifier');
}

function currentTargets(): Targets {
  const facts = document.querySelector<HTMLElement>('.weedoFactsScanActions');
  const ownerButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => !button.hasAttribute('data-geoweedo-photo-scanner') && /Scan QR\s*\/\s*barcode/i.test(button.textContent || ''));
  const owner = ownerButton?.parentElement || null;
  const mapDialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Scan a product barcode or QR code"] > div');
  const nativeControls = document.querySelector<HTMLElement>('[data-geoweedo-native-scanner-overlay="1"] .native-product-scanner__buttons');
  return { facts, owner, mapDialog, nativeControls };
}

function sameTargets(a: Targets, b: Targets) {
  return a.facts === b.facts
    && a.owner === b.owner
    && a.mapDialog === b.mapDialog
    && a.nativeControls === b.nativeControls;
}

function scannedType(result: WeedoFactsScanResult) {
  const value = String(result?.value || '').trim();
  const format = String(result?.format ?? '').toUpperCase();
  if (/^https?:\/\//i.test(value) || format.includes('QR') || format.includes('DATA_MATRIX')) return 'qr';
  if (/^\d{8,14}$/.test(value.replace(/[\s-]/g, ''))) return 'upc';
  return undefined;
}

async function sleep(ms: number) {
  await new Promise(resolve => window.setTimeout(resolve, ms));
}

export default function GlobalPhotoBarcodeScanner() {
  const [targets, setTargets] = useState<Targets>(emptyTargets);
  const [message, setMessage] = useState('');
  const queryHandledRef = useRef(false);

  useEffect(() => {
    const refresh = () => {
      const next = currentTargets();
      setTargets(current => sameTargets(current, next) ? current : next);
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(refresh, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (queryHandledRef.current || !targets.facts) return;
    const url = new URL(window.location.href);
    const scan = String(url.searchParams.get('scan') || '').trim();
    if (!scan) return;
    const input = factsScanInput();
    if (!input) return;

    queryHandledRef.current = true;
    if (submitExistingLookup(input, scan)) {
      url.searchParams.delete('scan');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [targets.facts]);

  async function postScan(result: WeedoFactsScanResult) {
    const value = result.value.trim();
    const response = await fetch('/api/weedo-facts/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: value, type: scannedType(result) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Product lookup failed.');
    return body;
  }

  async function resolveMapScan(result: WeedoFactsScanResult) {
    setMessage('Reading GeoWeedo Facts…');
    const value = result.value.trim();

    try {
      const body = await postScan(result);
      const record = body?.record || null;
      const productId = String(record?.productId || body?.productId || '').trim();
      const batchId = String(record?.batchId || body?.batchId || '').trim();
      if (body?.found && productId) {
        const href = `/product/${encodeURIComponent(productId)}${batchId ? `?batch=${encodeURIComponent(batchId)}` : ''}`;
        window.location.assign(href);
        return;
      }

      window.location.assign(`/geoweedo-facts?scan=${encodeURIComponent(value)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not look up the code from that photo.');
    }
  }

  async function handleFactsPhoto(result: WeedoFactsScanResult, input: HTMLInputElement) {
    const value = result.value.trim();

    // URL-based QR scans already use /api/weedo-facts/scan when the existing form submits.
    // Persist non-URL photo scans first so UPC/EAN and package barcodes follow the same scan audit path.
    if (!/^https?:\/\//i.test(value)) {
      setMessage('Reading GeoWeedo Facts…');
      try {
        await postScan(result);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not record the code from that photo.');
        return;
      }
    }

    setMessage('');
    submitExistingLookup(input, value);
  }

  async function handlePhotoResult(result: WeedoFactsScanResult) {
    const value = String(result?.value || '').trim();
    if (!value) return;
    setMessage('');

    const ownerInput = ownerScanInput();
    if (targets.owner && ownerInput && submitExistingLookup(ownerInput, value)) return;

    const factsInput = factsScanInput();
    if (targets.facts && factsInput) {
      await handleFactsPhoto(result, factsInput);
      return;
    }

    await resolveMapScan(result);
  }

  function handleError(error: string) {
    setMessage(error);
  }

  const factsClass = targets.facts?.querySelector<HTMLButtonElement>('button:not([data-geoweedo-photo-scanner])')?.className || undefined;
  const ownerClass = targets.owner?.querySelector<HTMLButtonElement>('button:not([data-geoweedo-photo-scanner])')?.className || undefined;

  return (
    <>
      {targets.facts ? createPortal(
        <PhotoBarcodeScanButton
          onScan={handlePhotoResult}
          onError={handleError}
          className={factsClass}
          label="🖼️ Scan from photo"
        />,
        targets.facts,
      ) : null}

      {targets.owner ? createPortal(
        <PhotoBarcodeScanButton
          onScan={handlePhotoResult}
          onError={handleError}
          className={ownerClass}
          label="🖼️ Scan from photo"
        />,
        targets.owner,
      ) : null}

      {targets.mapDialog ? createPortal(
        <div style={{ padding: '0 16px 16px', display: 'flex', justifyContent: 'center' }}>
          <PhotoBarcodeScanButton
            onScan={handlePhotoResult}
            onError={handleError}
            beforeScan={async () => {
              targets.mapDialog?.querySelector<HTMLButtonElement>('button[aria-label="Close scanner"]')?.click();
              await sleep(120);
            }}
            style={{
              minHeight: 42,
              padding: '9px 14px',
              border: '1px solid rgba(126,217,87,.36)',
              borderRadius: 11,
              background: 'rgba(126,217,87,.12)',
              color: '#eef7ef',
              fontWeight: 850,
              cursor: 'pointer',
            }}
          />
        </div>,
        targets.mapDialog,
      ) : null}

      {targets.nativeControls ? createPortal(
        <PhotoBarcodeScanButton
          onScan={handlePhotoResult}
          onError={handleError}
          beforeScan={async () => {
            cancelNativeProductScanner();
            await sleep(220);
          }}
          label="🖼️ Photo"
        />,
        targets.nativeControls,
      ) : null}

      {message ? (
        <div
          role="alert"
          data-geoweedo-photo-scan-message="1"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
            transform: 'translateX(-50%)',
            zIndex: 11000,
            width: 'min(520px, calc(100% - 28px))',
            padding: '12px 44px 12px 14px',
            border: '1px solid rgba(126,217,87,.34)',
            borderRadius: 13,
            background: 'rgba(7,16,9,.97)',
            boxShadow: '0 18px 48px rgba(0,0,0,.5)',
            color: '#eef7ef',
            fontSize: 13,
            fontWeight: 750,
            lineHeight: 1.45,
          }}
        >
          {message}
          <button
            type="button"
            onClick={() => setMessage('')}
            aria-label="Dismiss photo scan message"
            style={{ position: 'absolute', right: 8, top: 7, width: 30, height: 30, border: 0, background: 'transparent', color: '#fff', fontSize: 19, cursor: 'pointer' }}
          >×</button>
        </div>
      ) : null}
    </>
  );
}
