'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './ProductCategoryManager.module.css';

type Category = { id: string; slug: string; name: string; sort_order: number };
type Product = {
  id: string;
  brand_name: string | null;
  product_name: string;
  product_type: string | null;
  category_id: string | null;
  category_name: string | null;
  category_source: string | null;
  net_contents: string | null;
};
type Stats = { products?: number; categorizedProducts?: number; uncategorizedProducts?: number };

export default function ProductCategoryManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [query, setQuery] = useState('');
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load(search = '') {
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    const response = await fetch(`/api/admin/products-menus${params.size ? `?${params}` : ''}`, { cache: 'no-store' });
    if (response.status === 401) { window.location.href = '/admin/login'; return; }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not load product categories.');
    setCategories(Array.isArray(body.categories) ? body.categories : []);
    setProducts(Array.isArray(body.products) ? body.products : []);
    setStats(body.stats || {});
  }

  useEffect(() => { void load().catch(err => setError(err instanceof Error ? err.message : 'Could not load categories.')); }, []);

  const shown = useMemo(() => onlyUncategorized ? products.filter(product => !product.category_id) : products, [products, onlyUncategorized]);

  async function assign(product: Product, categoryId: string) {
    if (!categoryId) return;
    setSavingId(product.id);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/products-menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign-product-category', productId: product.id, categoryId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not update product category.');
      const category = categories.find(item => item.id === categoryId);
      setProducts(current => current.map(item => item.id === product.id ? { ...item, category_id: categoryId, category_name: category?.name || item.category_name, category_source: 'admin' } : item));
      setStats(current => ({
        ...current,
        categorizedProducts: Number(current.categorizedProducts || 0) + (product.category_id ? 0 : 1),
        uncategorizedProducts: Math.max(0, Number(current.uncategorizedProducts || 0) - (product.category_id ? 0 : 1)),
      }));
      setNotice(`${product.product_name} → ${category?.name || 'category updated'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update product category.');
    } finally {
      setSavingId('');
    }
  }

  return <section className={styles.panel}>
    <div className={styles.head}>
      <div><span>CANONICAL TAXONOMY</span><h2>Product categories</h2><p>GeoWeedo keeps the original product type from each source, while this category controls consistent grouping across products and dispensary menus.</p></div>
      <div className={styles.coverage}><strong>{Number(stats.categorizedProducts || 0).toLocaleString()}</strong><span>categorized</span><b>{Number(stats.uncategorizedProducts || 0).toLocaleString()} need review</b></div>
    </div>

    <div className={styles.toolbar}>
      <form onSubmit={event => { event.preventDefault(); void load(query).catch(err => setError(err instanceof Error ? err.message : 'Search failed.')); }}>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search products, source type or category" />
        <button>Search</button>
      </form>
      <label><input type="checkbox" checked={onlyUncategorized} onChange={event => setOnlyUncategorized(event.target.checked)} /> Needs category only</label>
    </div>

    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}

    <div className={styles.categoryStrip}>{categories.map(category => <span key={category.id}>{category.name}</span>)}</div>

    {shown.length === 0 ? <div className={styles.empty}>No products match this category view.</div> : <div className={styles.list}>{shown.map(product => <article key={product.id}>
      <div className={styles.identity}>
        <a href={`/product/${encodeURIComponent(product.id)}`} target="_blank">{product.brand_name ? `${product.brand_name} · ` : ''}{product.product_name}</a>
        <small>Source type: {product.product_type || '—'}{product.net_contents ? ` · ${product.net_contents}` : ''}</small>
        <em>{product.category_source === 'admin' ? 'Admin assigned' : product.category_source === 'auto' ? 'Auto-mapped from source type' : product.category_source ? `Category source: ${product.category_source}` : 'Needs category review'}</em>
      </div>
      <label>
        <span>GeoWeedo category</span>
        <select value={product.category_id || ''} disabled={savingId === product.id} onChange={event => void assign(product, event.target.value)}>
          <option value="">Choose category…</option>
          {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
    </article>)}</div>}
  </section>;
}
