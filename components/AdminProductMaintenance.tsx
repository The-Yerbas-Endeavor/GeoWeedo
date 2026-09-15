'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import styles from './AdminProductMaintenance.module.css';

type Product = {
  id: string;
  brand_name: string | null;
  product_name: string;
  product_type: string | null;
  net_contents: string | null;
  category_name: string | null;
  updated_at: string;
  batch_count: number;
  identifier_count: number;
  variant_count: number;
  menu_count: number;
  qr_count: number;
  possible_duplicate_count: number;
};

type Payload = {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  sort: string;
  duplicateGroups: number;
  mergedCount: number;
};

const emptyPayload: Payload = { products: [], total: 0, page: 1, pageSize: 25, pageCount: 1, sort: 'duplicates', duplicateGroups: 0, mergedCount: 0 };

function label(product: Product | null) {
  if (!product) return '—';
  return `${product.brand_name ? `${product.brand_name} · ` : ''}${product.product_name}`;
}

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export default function AdminProductMaintenance() {
  const [data, setData] = useState<Payload>(emptyPayload);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState('duplicates');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [editBrand, setEditBrand] = useState('');
  const [editName, setEditName] = useState('');
  const [mergeSource, setMergeSource] = useState<Product | null>(null);
  const [targetQuery, setTargetQuery] = useState('');
  const [targetOptions, setTargetOptions] = useState<Product[]>([]);
  const [targetId, setTargetId] = useState('');
  const [targetLoading, setTargetLoading] = useState(false);

  async function load(nextPage = page, nextQ = q, nextSort = sort, nextPageSize = pageSize) {
    const params = new URLSearchParams({ page: String(nextPage), pageSize: String(nextPageSize), sort: nextSort });
    if (nextQ.trim()) params.set('q', nextQ.trim());
    const response = await fetch(`/api/admin/product-maintenance?${params}`, { cache: 'no-store' });
    if (response.status === 401) { window.location.href = '/admin/login'; return; }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not load product maintenance data.');
    setData(body);
    setPage(body.page || 1);
  }

  useEffect(() => {
    setLoading(true);
    load(1, '', 'duplicates', 25).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);

  const mergeTarget = useMemo(() => targetOptions.find(product => product.id === targetId) || null, [targetOptions, targetId]);

  async function search(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(''); setNotice('');
    try { setPage(1); await load(1, q, sort, pageSize); }
    catch (err) { setError(err instanceof Error ? err.message : 'Search failed.'); }
    finally { setLoading(false); }
  }

  async function changeSort(nextSort: string) {
    setSort(nextSort); setPage(1); setLoading(true); setError('');
    try { await load(1, q, nextSort, pageSize); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sort failed.'); }
    finally { setLoading(false); }
  }

  async function changePageSize(nextSize: number) {
    setPageSize(nextSize); setPage(1); setLoading(true); setError('');
    try { await load(1, q, sort, nextSize); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not change page size.'); }
    finally { setLoading(false); }
  }

  async function goPage(nextPage: number) {
    setLoading(true); setError('');
    try { await load(nextPage, q, sort, pageSize); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load page.'); }
    finally { setLoading(false); }
  }

  function beginEdit(product: Product) {
    setEditing(product);
    setEditBrand(product.brand_name || '');
    setEditName(product.product_name);
    setMergeSource(null);
    setError(''); setNotice('');
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !editName.trim()) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/product-maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-product', productId: editing.id, brandName: editBrand, productName: editName }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not update product.');
      setNotice(`Updated ${editBrand.trim() ? `${editBrand.trim()} · ` : ''}${editName.trim()}.`);
      setEditing(null);
      await load(page, q, sort, pageSize);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update product.'); }
    finally { setSaving(false); }
  }

  async function findTargets(query: string, sourceId: string) {
    setTargetLoading(true); setError('');
    try {
      const params = new URLSearchParams({ q: query.trim(), page: '1', pageSize: '100', sort: 'name_asc' });
      const response = await fetch(`/api/admin/product-maintenance?${params}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not find merge targets.');
      const options = (Array.isArray(body.products) ? body.products : []).filter((product: Product) => product.id !== sourceId);
      setTargetOptions(options);
      setTargetId(options[0]?.id || '');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not find merge targets.'); }
    finally { setTargetLoading(false); }
  }

  function beginMerge(product: Product) {
    setMergeSource(product);
    setEditing(null);
    const initial = product.product_name;
    setTargetQuery(initial);
    setTargetOptions([]); setTargetId(''); setNotice(''); setError('');
    findTargets(initial, product.id);
  }

  async function searchTargets(event: FormEvent) {
    event.preventDefault();
    if (!mergeSource) return;
    await findTargets(targetQuery, mergeSource.id);
  }

  async function mergeProducts() {
    if (!mergeSource || !mergeTarget) return;
    const confirmed = window.confirm(
      `Merge duplicate “${label(mergeSource)}” into “${label(mergeTarget)}”?\n\nThe surviving product keeps its identity. Linked batches, identifiers, variants, menus, scans, media and product relationships will be moved to it. The duplicate product record will then be removed.`,
    );
    if (!confirmed) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/product-maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge-product', sourceProductId: mergeSource.id, targetProductId: mergeTarget.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not merge products.');
      const moved = body.counts || {};
      setNotice(`Merged ${label(mergeSource)} into ${label(mergeTarget)}. Moved ${Number(moved.batches || 0)} batches, ${Number(moved.identifiers || 0)} identifiers, ${Number(moved.variants || 0)} variants, ${Number(moved.menuItems || 0)} menu links and ${Number(moved.qrScans || 0)} QR records.`);
      setMergeSource(null); setTargetOptions([]); setTargetId('');
      await load(page, q, sort, pageSize);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not merge products.'); }
    finally { setSaving(false); }
  }

  function sortButton(title: string, asc: string, desc: string) {
    const activeAsc = sort === asc;
    const activeDesc = sort === desc;
    return <button type="button" className={styles.sortButton} onClick={() => changeSort(activeAsc ? desc : asc)}>{title} {activeAsc ? '↑' : activeDesc ? '↓' : '↕'}</button>;
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><span>GEOWEEDO ADMIN · PRODUCTS</span><h1>Product maintenance</h1><p>Edit canonical brand/product names and safely combine duplicate product records without losing linked lab, scanner, menu, media, or cultivar data.</p></div>
      <div className={styles.headerLinks}><a href="/admin/products-menus">Products & scans</a><a href="/admin">Admin</a></div>
    </header>

    <section className={styles.stats}>
      <article><strong>{data.total.toLocaleString()}</strong><span>Canonical products</span></article>
      <article><strong>{data.duplicateGroups.toLocaleString()}</strong><span>Exact duplicate groups</span></article>
      <article><strong>{data.mergedCount.toLocaleString()}</strong><span>Merges recorded</span></article>
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span>CATALOG CLEANUP</span><h2>Edit or merge products</h2><p>Likely exact duplicates are shown first. Search can also find any two records you want to combine.</p></div></div>
      <form className={styles.toolbar} onSubmit={search}>
        <input value={q} onChange={event => setQ(event.target.value)} placeholder="Search brand, product, category…" aria-label="Search products" />
        <select value={sort} onChange={event => changeSort(event.target.value)} aria-label="Sort products">
          <option value="duplicates">Likely duplicates first</option><option value="name_asc">Product A–Z</option><option value="name_desc">Product Z–A</option><option value="brand_asc">Brand A–Z</option><option value="brand_desc">Brand Z–A</option><option value="updated_desc">Recently updated</option><option value="batches_desc">Most batches</option>
        </select>
        <select value={pageSize} onChange={event => changePageSize(Number(event.target.value))} aria-label="Rows per page"><option value={25}>25 rows</option><option value={50}>50 rows</option><option value={100}>100 rows</option></select>
        <button type="submit">Search</button>
      </form>

      {loading ? <div className={styles.empty}>Loading products…</div> : data.products.length === 0 ? <div className={styles.empty}>No products match this search.</div> : <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>{sortButton('Product','name_asc','name_desc')}</th><th>{sortButton('Brand','brand_asc','brand_desc')}</th><th>Category / type</th><th>{sortButton('Batches','batches_asc','batches_desc')}</th><th>Linked data</th><th>{sortButton('Updated','updated_asc','updated_desc')}</th><th>Actions</th></tr></thead>
        <tbody>{data.products.map(product => <tr key={product.id} className={product.possible_duplicate_count ? styles.duplicateRow : undefined}>
          <td><a href={`/product/${encodeURIComponent(product.id)}`} target="_blank">{product.product_name}</a>{product.possible_duplicate_count ? <b className={styles.duplicateBadge}>Possible duplicate</b> : null}<small>{product.net_contents || '—'}</small></td>
          <td>{product.brand_name || <span className={styles.muted}>Not reported</span>}</td>
          <td><span>{product.category_name || 'Other'}</span><small>{product.product_type || '—'}</small></td>
          <td>{Number(product.batch_count || 0).toLocaleString()}</td>
          <td><span>{Number(product.identifier_count || 0)} IDs · {Number(product.variant_count || 0)} variants</span><small>{Number(product.menu_count || 0)} menus · {Number(product.qr_count || 0)} QR</small></td>
          <td>{date(product.updated_at)}</td>
          <td><div className={styles.actions}><button type="button" onClick={() => beginEdit(product)}>Edit</button><button type="button" className={styles.mergeButton} onClick={() => beginMerge(product)}>Merge duplicate</button></div></td>
        </tr>)}</tbody>
      </table></div>}

      <nav className={styles.pagination} aria-label="Product maintenance pages"><button type="button" disabled={data.page <= 1 || loading} onClick={() => goPage(data.page - 1)}>← Previous</button><strong>Page {data.page.toLocaleString()} of {data.pageCount.toLocaleString()} · {data.total.toLocaleString()} products</strong><button type="button" disabled={data.page >= data.pageCount || loading} onClick={() => goPage(data.page + 1)}>Next →</button></nav>
    </section>

    {editing ? <section className={styles.editor} aria-label="Edit product">
      <div className={styles.editorHead}><div><span>EDIT CANONICAL PRODUCT</span><h2>{label(editing)}</h2></div><button type="button" onClick={() => setEditing(null)}>Close</button></div>
      <form className={styles.editForm} onSubmit={saveEdit}><label>Brand<input value={editBrand} onChange={event => setEditBrand(event.target.value)} placeholder="Brand not reported" /></label><label>Product name<input required value={editName} onChange={event => setEditName(event.target.value)} /></label><button type="submit" disabled={saving || !editName.trim()}>{saving ? 'Saving…' : 'Save product'}</button></form>
      <p>Brand changes also update linked menu rows that were using the old canonical brand. Source-reported QR text and lab evidence remain untouched.</p>
    </section> : null}

    {mergeSource ? <section className={`${styles.editor} ${styles.mergeEditor}`} aria-label="Merge duplicate product">
      <div className={styles.editorHead}><div><span>MERGE DUPLICATE</span><h2>Duplicate: {label(mergeSource)}</h2></div><button type="button" onClick={() => setMergeSource(null)}>Close</button></div>
      <div className={styles.mergeWarning}><strong>The target below is the product that survives.</strong><span>The duplicate record above will be removed only after every linked database reference can be moved successfully in one transaction.</span></div>
      <form className={styles.targetSearch} onSubmit={searchTargets}><input value={targetQuery} onChange={event => setTargetQuery(event.target.value)} placeholder="Search for the product to keep…" /><button type="submit" disabled={targetLoading}>{targetLoading ? 'Searching…' : 'Find target'}</button></form>
      <label className={styles.targetSelect}>Product to keep<select value={targetId} onChange={event => setTargetId(event.target.value)} disabled={targetLoading || targetOptions.length === 0}><option value="">Choose surviving product…</option>{targetOptions.map(product => <option key={product.id} value={product.id}>{label(product)} · {product.batch_count} batches</option>)}</select></label>
      {mergeTarget ? <div className={styles.mergeCompare}><div><small>REMOVE DUPLICATE</small><strong>{label(mergeSource)}</strong><span>{mergeSource.batch_count} batches · {mergeSource.identifier_count} IDs · {mergeSource.menu_count} menus</span></div><b>→</b><div><small>KEEP PRODUCT</small><strong>{label(mergeTarget)}</strong><span>{mergeTarget.batch_count} batches · {mergeTarget.identifier_count} IDs · {mergeTarget.menu_count} menus</span></div></div> : null}
      <button type="button" className={styles.confirmMerge} disabled={saving || !mergeTarget} onClick={mergeProducts}>{saving ? 'Merging…' : 'Merge duplicate into selected product'}</button>
    </section> : null}
  </main>;
}
