'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { isNativeApp, scanWeedoFactsCode } from '@/lib/native';
import styles from './OwnerMenuScanner.module.css';

type ScanRecord = {
  productId: string;
  batchId: string | null;
  brandName: string | null;
  productName: string;
  productType: string | null;
  netContents: string | null;
  matchLevel: string;
  batchNumber: string | null;
  uid: string | null;
  coaNumber: string | null;
  labName: string | null;
  overallStatus: string | null;
  source?: { type?: string; verified?: boolean };
};

type MenuItem = {
  id: string;
  item_name: string;
  brand_name: string | null;
  category: string | null;
  variant: string | null;
  package_size: string | null;
  price_cents: number | null;
  inventory_status: string;
  verified: number;
  linked_product_name: string | null;
  linked_batch_number: string | null;
  linked_uid: string | null;
  linked_batch_verified: number | null;
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
      else reject(new Error('Compatible QR scanner could not load.'));
    };
    if (existing) {
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => reject(new Error('Compatible QR scanner could not load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.geoweedoZxing = '1';
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Compatible QR scanner could not load.')), { once: true });
    document.head.appendChild(script);
  });
  return zxingLoader;
}

function money(cents: number | null) {
  return Number.isFinite(Number(cents)) ? `$${(Number(cents) / 100).toFixed(2)}` : '—';
}

export default function OwnerMenuScanner({ dispensaryId }: { dispensaryId: string }) {
  const [scanValue, setScanValue] = useState('');
  const [record, setRecord] = useState<ScanRecord | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ itemName: '', brandName: '', category: '', variant: '', packageSize: '', price: '', inventoryStatus: 'in_stock', sourceUrl: '' });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<any>(null);

  useEffect(() => () => stopScanner(), []);
  useEffect(() => {
    if (!dispensaryId) return;
    setRecord(null);
    setScanValue('');
    setError('');
    setNotice('');
    void loadMenu();
  }, [dispensaryId]);

  async function loadMenu() {
    const response = await fetch(`/api/admin/owner-menu?dispensaryId=${encodeURIComponent(dispensaryId)}`, { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not load your dispensary menu.');
    setMenuItems(Array.isArray(body.menuItems) ? body.menuItems : []);
  }

  function stopScanner() {
    try { controlsRef.current?.stop?.(); } catch {}
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerOpen(false);
  }

  async function resolveScan(rawValue: string) {
    const value = rawValue.trim();
    if (!value) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const type = /^https?:\/\//i.test(value) ? 'qr' : /^\d{8,14}$/.test(value.replace(/[\s-]/g, '')) ? 'upc' : 'qr';
      const response = await fetch('/api/weedo-facts/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: value, type }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Product scan lookup failed.');
      if (!body.found || !body.record?.productId) {
        throw new Error('GeoWeedo could not link this code to a canonical product yet. Add/verify it in Weedo Facts before publishing it to a menu.');
      }
      const next = body.record as ScanRecord;
      setScanValue(value);
      setRecord(next);
      setForm({
        itemName: next.productName || '',
        brandName: next.brandName || '',
        category: next.productType || '',
        variant: '',
        packageSize: next.netContents || '',
        price: '',
        inventoryStatus: 'in_stock',
        sourceUrl: /^https?:\/\//i.test(value) ? value : '',
      });
    } catch (scanError) {
      setRecord(null);
      setError(scanError instanceof Error ? scanError.message : 'Product scan lookup failed.');
    } finally {
      setLoading(false);
    }
  }

  async function scanNative() {
    try {
      setError('');
      const result = await scanWeedoFactsCode();
      await resolveScan(result.value);
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : String(scanError || '');
      if (!/cancel/i.test(message)) setError(message || 'Native QR scanner could not start.');
    }
  }

  async function startScanner() {
    setError('');
    setNotice('');
    if (isNativeApp()) {
      await scanNative();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this browser.');
      return;
    }

    try {
      setScannerMessage('Loading QR scanner…');
      const zxing = await loadZxingBrowser();
      setScannerOpen(true);
      await new Promise(resolve => setTimeout(resolve, 0));
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview could not start.');
      setScannerMessage('Point the camera at the product QR code.');
      const reader = new zxing.BrowserMultiFormatReader();
      const barcodeFormat = zxing.BarcodeFormat;
      if (barcodeFormat) {
        const formats = [barcodeFormat.QR_CODE, barcodeFormat.UPC_A, barcodeFormat.UPC_E, barcodeFormat.EAN_13, barcodeFormat.EAN_8, barcodeFormat.CODE_128]
          .filter((format: unknown) => format !== undefined && format !== null);
        if (formats.length) reader.possibleFormats = formats;
      }
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
        video,
        (scanResult: any) => {
          const value = scanResult?.getText?.() || scanResult?.text;
          if (!value) return;
          stopScanner();
          void resolveScan(String(value));
        },
      );
      controlsRef.current = controls;
      streamRef.current = video.srcObject instanceof MediaStream ? video.srcObject : null;
    } catch (scanError) {
      stopScanner();
      setError(scanError instanceof Error ? scanError.message : 'Camera scanner could not start.');
    }
  }

  async function manualLookup(event: FormEvent) {
    event.preventDefault();
    await resolveScan(scanValue);
  }

  async function addToMenu(event: FormEvent) {
    event.preventDefault();
    if (!record) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/owner-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispensaryId,
          productId: record.productId,
          batchId: record.batchId,
          scanValue,
          ...form,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not add this product to the menu.');
      setMenuItems(Array.isArray(body.menuItems) ? body.menuItems : []);
      setNotice(`${record.productName} was added to this dispensary menu${body.product?.verifiedLabBatch ? ' with its verified COA batch linked' : ''}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add this product to the menu.');
    } finally {
      setSaving(false);
    }
  }

  const verifiedBatch = Boolean(record?.batchId && record?.source?.verified && record?.source?.type === 'lab' && record?.matchLevel === 'exact_batch');

  return <section className={styles.panel}>
    <div className={styles.head}><div><span>OWNER MENU SCANNER</span><h2>Scan product → add to menu</h2><p>Scan a package QR code. GeoWeedo resolves it through Weedo Facts first, then links the canonical product and exact verified batch to your dispensary menu.</p></div></div>

    <div className={styles.scanActions}>
      <button type="button" className={styles.primary} onClick={startScanner} disabled={loading || scannerOpen}>{loading ? 'Checking…' : '📷 Scan product QR'}</button>
      {scannerOpen ? <button type="button" className={styles.secondary} onClick={stopScanner}>Cancel camera</button> : null}
    </div>

    {scannerOpen ? <div className={styles.scanner}><div className={styles.videoFrame}><video ref={videoRef} playsInline muted/><div className={styles.scanBox}/></div><p>{scannerMessage}</p></div> : null}

    <form className={styles.manual} onSubmit={manualLookup}>
      <input value={scanValue} onChange={event => setScanValue(event.target.value)} placeholder="Or paste a QR URL / barcode" autoComplete="off"/>
      <button className={styles.secondary} disabled={loading || !scanValue.trim()}>{loading ? 'Checking…' : 'Look up'}</button>
    </form>

    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}

    {record ? <div className={styles.resolved}>
      <div className={styles.resolvedTop}>
        <div><strong>{record.brandName ? `${record.brandName} · ` : ''}{record.productName}</strong><small>{[record.productType, record.netContents, record.batchNumber ? `Batch ${record.batchNumber}` : null, record.uid ? `UID ${record.uid}` : null].filter(Boolean).join(' · ')}</small></div>
        <span className={verifiedBatch ? styles.verified : styles.sourceBacked}>{verifiedBatch ? '✓ COA verified batch' : 'Canonical product'}</span>
      </div>
      {record.coaNumber || record.labName ? <div className={styles.code}>{[record.labName, record.coaNumber ? `COA ${record.coaNumber}` : null, record.overallStatus].filter(Boolean).join(' · ')}</div> : null}
      <form className={styles.form} onSubmit={addToMenu}>
        <label>Menu item name<input required value={form.itemName} onChange={event => setForm(current => ({ ...current, itemName: event.target.value }))}/></label>
        <div className={styles.row}><label>Brand<input value={form.brandName} onChange={event => setForm(current => ({ ...current, brandName: event.target.value }))}/></label><label>Category<input value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))}/></label></div>
        <div className={styles.row}><label>Variant<input value={form.variant} onChange={event => setForm(current => ({ ...current, variant: event.target.value }))} placeholder="Indica, 510 cart…"/></label><label>Package size<input value={form.packageSize} onChange={event => setForm(current => ({ ...current, packageSize: event.target.value }))} placeholder="1 g, 3.5 g…"/></label></div>
        <div className={styles.row}><label>Price USD<input inputMode="decimal" value={form.price} onChange={event => setForm(current => ({ ...current, price: event.target.value }))} placeholder="35.00"/></label><label>Inventory<select value={form.inventoryStatus} onChange={event => setForm(current => ({ ...current, inventoryStatus: event.target.value }))}><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="unknown">Unknown</option><option value="out_of_stock">Out of stock</option></select></label></div>
        <label>Source URL<input value={form.sourceUrl} onChange={event => setForm(current => ({ ...current, sourceUrl: event.target.value }))} placeholder="QR / menu source URL"/></label>
        <button className={styles.primary} disabled={saving}>{saving ? 'Adding…' : 'Add product to my menu'}</button>
      </form>
    </div> : null}

    <div className={styles.menu}>
      <div className={styles.menuHead}><h3>Current menu</h3><span>{menuItems.length.toLocaleString()} active items</span></div>
      {menuItems.length === 0 ? <div className={styles.empty}>No products have been added to this menu yet.</div> : <div className={styles.menuList}>{menuItems.map(item => <article className={styles.menuItem} key={item.id}><div><strong>{item.brand_name ? `${item.brand_name} · ` : ''}{item.item_name}</strong><small>{[item.category, item.variant, item.package_size, item.linked_batch_number ? `Batch ${item.linked_batch_number}` : null].filter(Boolean).join(' · ')}</small>{item.linked_uid ? <span className={styles.code}>{item.linked_uid}</span> : null}</div><div><b>{money(item.price_cents)}</b><small>{item.inventory_status.replace(/_/g, ' ')} · {item.verified ? '✓ Owner verified' : 'Reported'}</small></div></article>)}</div>}
    </div>
  </section>;
}
