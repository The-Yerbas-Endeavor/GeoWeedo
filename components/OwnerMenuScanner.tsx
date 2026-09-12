'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { isNativeApp, scanWeedoFactsCode } from '@/lib/native';
import styles from './OwnerMenuScanner.module.css';

type IdentifierType = 'qr' | 'upc' | 'barcode';
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
  product_id: string | null;
  batch_id: string | null;
  item_name: string;
  brand_name: string | null;
  category: string | null;
  variant: string | null;
  package_size: string | null;
  price_cents: number | null;
  inventory_status: string;
  source_type: string;
  verified: number;
  owner_scan_type?: string | null;
  owner_scan_value?: string | null;
  linked_product_name: string | null;
  linked_batch_number: string | null;
  linked_uid: string | null;
  linked_batch_verified: number | null;
};

type MenuForm = {
  itemName: string;
  brandName: string;
  category: string;
  variant: string;
  packageSize: string;
  price: string;
  inventoryStatus: string;
  sourceUrl: string;
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

function money(cents: number | null) {
  return Number.isFinite(Number(cents)) ? `$${(Number(cents) / 100).toFixed(2)}` : '—';
}

function inferIdentifierType(value: string): IdentifierType {
  if (/^https?:\/\//i.test(value)) return 'qr';
  if (/^\d{8,14}$/.test(value.replace(/[\s-]/g, ''))) return 'upc';
  return 'barcode';
}

function blankForm(sourceUrl = ''): MenuForm {
  return { itemName: '', brandName: '', category: '', variant: '', packageSize: '', price: '', inventoryStatus: 'in_stock', sourceUrl };
}

export default function OwnerMenuScanner({ dispensaryId, apiBase = '/api/admin/owner-menu' }: { dispensaryId: string; apiBase?: string }) {
  const [scanValue, setScanValue] = useState('');
  const [identifierType, setIdentifierType] = useState<IdentifierType>('qr');
  const [record, setRecord] = useState<ScanRecord | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<MenuForm>(blankForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Omit<MenuForm, 'sourceUrl'>>(blankForm());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<any>(null);

  useEffect(() => () => stopScanner(), []);
  useEffect(() => {
    if (!dispensaryId) return;
    setRecord(null);
    setUnresolved(false);
    setScanValue('');
    setError('');
    setNotice('');
    void loadMenu().catch(loadError => setError(loadError instanceof Error ? loadError.message : 'Could not load your dispensary menu.'));
  }, [dispensaryId, apiBase]);

  async function loadMenu() {
    const response = await fetch(`${apiBase}?dispensaryId=${encodeURIComponent(dispensaryId)}`, { cache: 'no-store' });
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
    const type = inferIdentifierType(value);
    setLoading(true);
    setError('');
    setNotice('');
    setIdentifierType(type);
    setScanValue(value);
    try {
      const response = await fetch('/api/weedo-facts/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: value, type: type === 'barcode' ? undefined : type }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Product scan lookup failed.');

      if (!body.found || !body.record?.productId) {
        setRecord(null);
        setUnresolved(true);
        setForm(blankForm(/^https?:\/\//i.test(value) ? value : ''));
        setNotice('This code is not in the canonical GeoWeedo Facts product database yet. You can still add the item to your store menu as owner-reported inventory; the scan will remain available for later product reconciliation.');
        return;
      }

      const next = body.record as ScanRecord;
      setRecord(next);
      setUnresolved(false);
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
      setUnresolved(false);
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
      if (!/cancel/i.test(message)) setError(message || 'Native product scanner could not start.');
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
      setScannerMessage('Loading QR / barcode scanner…');
      const zxing = await loadZxingBrowser();
      setScannerOpen(true);
      await new Promise(resolve => setTimeout(resolve, 0));
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview could not start.');
      setScannerMessage('Point the camera at the package QR code or barcode. For UPC/EAN, fill most of the frame width.');
      const reader = new zxing.BrowserMultiFormatReader();
      const barcodeFormat = zxing.BarcodeFormat;
      if (barcodeFormat) {
        const formats = [
          barcodeFormat.QR_CODE,
          barcodeFormat.UPC_A,
          barcodeFormat.UPC_E,
          barcodeFormat.EAN_13,
          barcodeFormat.EAN_8,
          barcodeFormat.CODE_128,
          barcodeFormat.CODE_39,
          barcodeFormat.CODE_93,
          barcodeFormat.ITF,
          barcodeFormat.CODABAR,
        ].filter((format: unknown) => format !== undefined && format !== null);
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
    if (!record && !unresolved) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispensaryId,
          productId: record?.productId || null,
          batchId: record?.batchId || null,
          scanValue,
          identifierType,
          ...form,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not add this product to the menu.');
      setMenuItems(Array.isArray(body.menuItems) ? body.menuItems : []);
      if (body.resolution === 'owner_reported') {
        setNotice(`${form.itemName} was added to your menu as owner-reported inventory. GeoWeedo did not create an unverified canonical product from the unknown code.`);
      } else {
        setNotice(`${record?.productName || form.itemName} was added to this dispensary menu${body.product?.verifiedLabBatch ? ' with its verified COA batch linked' : ''}.`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add this product to the menu.');
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(item: MenuItem) {
    setEditingId(item.id);
    setEditForm({
      itemName: item.item_name || '',
      brandName: item.brand_name || '',
      category: item.category || '',
      variant: item.variant || '',
      packageSize: item.package_size || '',
      price: item.price_cents === null || item.price_cents === undefined ? '' : (item.price_cents / 100).toFixed(2),
      inventoryStatus: item.inventory_status || 'unknown',
    });
    setError('');
    setNotice('');
  }

  async function saveMenuItem(itemId: string) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(apiBase, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispensaryId, itemId, ...editForm }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not update this menu item.');
      setMenuItems(Array.isArray(body.menuItems) ? body.menuItems : []);
      setEditingId(null);
      setNotice('Menu item updated.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update this menu item.');
    } finally {
      setSaving(false);
    }
  }

  async function removeMenuItem(item: MenuItem) {
    if (!window.confirm(`Remove ${item.item_name} from the active menu?`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(apiBase, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispensaryId, itemId: item.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not remove this menu item.');
      setMenuItems(Array.isArray(body.menuItems) ? body.menuItems : []);
      if (editingId === item.id) setEditingId(null);
      setNotice(`${item.item_name} was removed from the active menu.`);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove this menu item.');
    } finally {
      setSaving(false);
    }
  }

  const verifiedBatch = Boolean(record?.batchId && record?.source?.verified && record?.source?.type === 'lab' && record?.matchLevel === 'exact_batch');
  const canAdd = Boolean((record || unresolved) && scanValue.trim());

  return <section className={styles.panel}>
    <div className={styles.head}><div><span>OWNER MENU SCANNER</span><h2>Scan product → add to menu</h2><p>Scan a package QR code, UPC/EAN, or other supported barcode. GeoWeedo links known products to GeoWeedo Facts and lets you add unknown codes as clearly marked owner-reported inventory.</p></div></div>

    <div className={styles.scanActions}>
      <button type="button" className={styles.primary} onClick={startScanner} disabled={loading || scannerOpen}>{loading ? 'Checking…' : '📷 Scan QR / barcode'}</button>
      {scannerOpen ? <button type="button" className={styles.secondary} onClick={stopScanner}>Cancel camera</button> : null}
    </div>

    {scannerOpen ? <div className={styles.scanner}><div className={styles.videoFrame}><video ref={videoRef} playsInline muted/><div className={styles.scanBox}/></div><p>{scannerMessage}</p></div> : null}

    <form className={styles.manual} onSubmit={manualLookup}>
      <input value={scanValue} onChange={event => setScanValue(event.target.value)} placeholder="Or paste/type a QR URL, UPC, EAN, or barcode" autoComplete="off"/>
      <button className={styles.secondary} disabled={loading || !scanValue.trim()}>{loading ? 'Checking…' : 'Look up'}</button>
    </form>

    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}

    {record || unresolved ? <div className={`${styles.resolved} ${unresolved ? styles.unresolved : ''}`}>
      <div className={styles.resolvedTop}>
        <div>
          <strong>{record ? `${record.brandName ? `${record.brandName} · ` : ''}${record.productName}` : 'Unknown product code'}</strong>
          <small>{record
            ? [record.productType, record.netContents, record.batchNumber ? `Batch ${record.batchNumber}` : null, record.uid ? `UID ${record.uid}` : null].filter(Boolean).join(' · ')
            : `${identifierType.toUpperCase()} · ${scanValue}`}</small>
        </div>
        <span className={verifiedBatch ? styles.verified : unresolved ? styles.ownerReported : styles.sourceBacked}>
          {verifiedBatch ? '✓ COA verified batch' : unresolved ? 'OWNER-REPORTED ITEM' : 'Canonical product'}
        </span>
      </div>
      {record && (record.coaNumber || record.labName) ? <div className={styles.code}>{[record.labName, record.coaNumber ? `COA ${record.coaNumber}` : null, record.overallStatus].filter(Boolean).join(' · ')}</div> : null}
      {unresolved ? <p className={styles.unresolvedNote}>Enter the package details you can read. This publishes the item on your dispensary menu but does not claim a lab verification or create a canonical product record.</p> : null}
      <form className={styles.form} onSubmit={addToMenu}>
        <label>Menu item name<input required value={form.itemName} onChange={event => setForm(current => ({ ...current, itemName: event.target.value }))} placeholder={unresolved ? 'Product name from package' : undefined}/></label>
        <div className={styles.row}><label>Brand<input value={form.brandName} onChange={event => setForm(current => ({ ...current, brandName: event.target.value }))}/></label><label>Category<input value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))} placeholder="Flower, vape, edible…"/></label></div>
        <div className={styles.row}><label>Variant<input value={form.variant} onChange={event => setForm(current => ({ ...current, variant: event.target.value }))} placeholder="Indica, 510 cart…"/></label><label>Package size<input value={form.packageSize} onChange={event => setForm(current => ({ ...current, packageSize: event.target.value }))} placeholder="1 g, 3.5 g…"/></label></div>
        <div className={styles.row}><label>Price USD<input inputMode="decimal" value={form.price} onChange={event => setForm(current => ({ ...current, price: event.target.value }))} placeholder="35.00"/></label><label>Inventory<select value={form.inventoryStatus} onChange={event => setForm(current => ({ ...current, inventoryStatus: event.target.value }))}><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="unknown">Unknown</option><option value="out_of_stock">Out of stock</option></select></label></div>
        <label>Source URL<input value={form.sourceUrl} onChange={event => setForm(current => ({ ...current, sourceUrl: event.target.value }))} placeholder="QR / menu source URL"/></label>
        <button className={styles.primary} disabled={saving || !canAdd}>{saving ? 'Saving…' : unresolved ? 'Add owner-reported item to my menu' : 'Add product to my menu'}</button>
      </form>
    </div> : null}

    <div className={styles.menu}>
      <div className={styles.menuHead}><h3>Current menu</h3><span>{menuItems.length.toLocaleString()} active items</span></div>
      {menuItems.length === 0 ? <div className={styles.empty}>No products have been added to this menu yet.</div> : <div className={styles.menuList}>{menuItems.map(item => {
        const ownerReported = !item.product_id || item.source_type === 'owner_reported_scan';
        return <article className={styles.menuItem} key={item.id}>
          <div className={styles.menuSummary}>
            <div><strong>{item.brand_name ? `${item.brand_name} · ` : ''}{item.item_name}</strong><small>{[item.category, item.variant, item.package_size, item.linked_batch_number ? `Batch ${item.linked_batch_number}` : null].filter(Boolean).join(' · ')}</small>{item.linked_uid ? <span className={styles.code}>{item.linked_uid}</span> : null}{item.owner_scan_value ? <span className={styles.scanCode}>{String(item.owner_scan_type || 'scan').toUpperCase()}: {item.owner_scan_value}</span> : null}</div>
            <div className={styles.menuPrice}><b>{money(item.price_cents)}</b><small>{item.inventory_status.replace(/_/g, ' ')}</small><span className={ownerReported ? styles.ownerReportedMini : styles.canonicalMini}>{ownerReported ? 'Owner reported' : item.linked_batch_verified ? 'COA-linked' : 'Canonical product'}</span></div>
          </div>
          <div className={styles.menuActions}>
            <button type="button" className={styles.secondary} onClick={() => editingId === item.id ? setEditingId(null) : beginEdit(item)}>{editingId === item.id ? 'Cancel' : 'Manage'}</button>
            <button type="button" className={styles.remove} onClick={() => void removeMenuItem(item)} disabled={saving}>Remove</button>
          </div>
          {editingId === item.id ? <div className={styles.editForm}>
            <label>Item name<input value={editForm.itemName} onChange={event => setEditForm(current => ({ ...current, itemName: event.target.value }))}/></label>
            <div className={styles.row}><label>Brand<input value={editForm.brandName} onChange={event => setEditForm(current => ({ ...current, brandName: event.target.value }))}/></label><label>Category<input value={editForm.category} onChange={event => setEditForm(current => ({ ...current, category: event.target.value }))}/></label></div>
            <div className={styles.row}><label>Variant<input value={editForm.variant} onChange={event => setEditForm(current => ({ ...current, variant: event.target.value }))}/></label><label>Package size<input value={editForm.packageSize} onChange={event => setEditForm(current => ({ ...current, packageSize: event.target.value }))}/></label></div>
            <div className={styles.row}><label>Price USD<input inputMode="decimal" value={editForm.price} onChange={event => setEditForm(current => ({ ...current, price: event.target.value }))}/></label><label>Inventory<select value={editForm.inventoryStatus} onChange={event => setEditForm(current => ({ ...current, inventoryStatus: event.target.value }))}><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="unknown">Unknown</option><option value="out_of_stock">Out of stock</option></select></label></div>
            <button type="button" className={styles.primary} onClick={() => void saveMenuItem(item.id)} disabled={saving || !editForm.itemName.trim()}>{saving ? 'Saving…' : 'Save menu changes'}</button>
          </div> : null}
        </article>;
      })}</div>}
    </div>
  </section>;
}
