import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { ensureWeedoMenuSchema } from '@/lib/weedoMenus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TERMS = 6;
const MAX_ROWS = 600;
const MAX_MATCHES_PER_DISPENSARY = 6;

function normalizeQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function searchTerms(value: string) {
  return normalizeQuery(value)
    .toLowerCase()
    .split(/\s+/)
    .map(term => term.replace(/[^a-z0-9.%+-]/g, ''))
    .filter(term => term.length >= 2)
    .slice(0, MAX_TERMS);
}

function inventoryAvailable(value: unknown) {
  const normalized = String(value || 'unknown').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return !['out_of_stock', 'sold_out', 'unavailable', 'discontinued', 'inactive'].includes(normalized);
}

function matchScore(row: any, query: string, exactProduct: boolean) {
  if (exactProduct) return 1000 + (row.item_verified ? 8 : 0);
  const q = query.toLowerCase();
  const item = String(row.item_name || '').toLowerCase();
  const menuBrand = String(row.menu_brand_name || '').toLowerCase();
  const product = String(row.product_name || '').toLowerCase();
  const productBrand = String(row.product_brand_name || '').toLowerCase();
  let score = 0;
  if (item === q || product === q) score += 120;
  else if (item.startsWith(q) || product.startsWith(q)) score += 90;
  else if (item.includes(q) || product.includes(q)) score += 65;
  if (menuBrand === q || productBrand === q) score += 80;
  else if (menuBrand.includes(q) || productBrand.includes(q)) score += 45;
  if (row.item_verified) score += 8;
  return score;
}

export async function GET(request: NextRequest) {
  const query = normalizeQuery(String(request.nextUrl.searchParams.get('q') || ''));
  const productId = normalizeQuery(String(request.nextUrl.searchParams.get('productId') || ''));
  const terms = searchTerms(query);
  if (!productId && (query.length < 2 || !terms.length)) {
    return NextResponse.json({ query, product: null, count: 0, dispensaries: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  ensureWeedoMenuSchema();
  const db = getDatabase();
  let product: any = null;
  if (productId) {
    product = db.prepare(`
      SELECT id, product_name, brand_name, product_type, net_contents
      FROM cannabis_products
      WHERE id = ?
      LIMIT 1
    `).get(productId) as any;
    if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  }

  const searchable = `LOWER(
    COALESCE(mi.item_name, '') || ' ' ||
    COALESCE(mi.brand_name, '') || ' ' ||
    COALESCE(mi.category, '') || ' ' ||
    COALESCE(mi.variant, '') || ' ' ||
    COALESCE(mi.package_size, '') || ' ' ||
    COALESCE(p.product_name, '') || ' ' ||
    COALESCE(p.brand_name, '') || ' ' ||
    COALESCE(p.product_type, '') || ' ' ||
    COALESCE(p.net_contents, '') || ' ' ||
    COALESCE(b.batch_number, '') || ' ' ||
    COALESCE(b.uid, '')
  )`;
  const termConditions = terms.map(() => `${searchable} LIKE ?`).join(' AND ');
  const matchCondition = productId ? 'mi.product_id = ?' : termConditions;
  const params = productId ? [productId] : terms.map(term => `%${term}%`);

  const rows = db.prepare(`
    SELECT
      d.id AS dispensary_id,
      d.name AS dispensary_name,
      d.city,
      d.region,
      d.country,
      d.latitude,
      d.longitude,
      mi.id AS menu_item_id,
      mi.product_id,
      mi.batch_id,
      mi.item_name,
      mi.brand_name AS menu_brand_name,
      mi.category,
      mi.variant,
      mi.package_size,
      mi.price_cents,
      mi.currency,
      mi.inventory_status,
      mi.verified AS item_verified,
      mi.source_url,
      mi.source_updated_at,
      p.product_name,
      p.brand_name AS product_brand_name,
      p.product_type,
      b.batch_number
    FROM dispensary_menu_items mi
    JOIN dispensary_menus m ON m.id = mi.menu_id
    JOIN dispensaries d ON d.id = m.dispensary_id
    LEFT JOIN cannabis_products p ON p.id = mi.product_id
    LEFT JOIN cannabis_batches b ON b.id = mi.batch_id
    WHERE mi.active = 1
      AND m.active = 1
      AND d.active = 1
      AND d.verified = 1
      AND d.latitude IS NOT NULL
      AND d.longitude IS NOT NULL
      AND ${matchCondition}
    ORDER BY mi.verified DESC, COALESCE(mi.source_updated_at, mi.updated_at) DESC
    LIMIT ${MAX_ROWS}
  `).all(...params) as any[];

  const grouped = new Map<string, any>();
  for (const row of rows) {
    if (!inventoryAvailable(row.inventory_status)) continue;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    let entry = grouped.get(row.dispensary_id);
    if (!entry) {
      entry = {
        id: String(row.dispensary_id),
        name: String(row.dispensary_name || 'Dispensary'),
        city: row.city || null,
        region: row.region || null,
        country: row.country || null,
        latitude: lat,
        longitude: lng,
        matches: [],
      };
      grouped.set(row.dispensary_id, entry);
    }

    if (entry.matches.length >= MAX_MATCHES_PER_DISPENSARY) continue;
    entry.matches.push({
      menuItemId: String(row.menu_item_id),
      productId: row.product_id || null,
      batchId: row.batch_id || null,
      itemName: String(row.item_name || row.product_name || 'Product'),
      brandName: row.menu_brand_name || row.product_brand_name || null,
      category: row.category || row.product_type || null,
      variant: row.variant || null,
      packageSize: row.package_size || null,
      priceCents: Number.isFinite(Number(row.price_cents)) ? Number(row.price_cents) : null,
      currency: row.currency || 'USD',
      inventoryStatus: row.inventory_status || 'unknown',
      verified: Boolean(row.item_verified),
      sourceUrl: row.source_url || null,
      sourceUpdatedAt: row.source_updated_at || null,
      batchNumber: row.batch_number || null,
      score: matchScore(row, query, Boolean(productId)),
    });
  }

  const dispensaries = [...grouped.values()]
    .map(entry => ({
      ...entry,
      matches: entry.matches.sort((a: any, b: any) => b.score - a.score || a.itemName.localeCompare(b.itemName)),
    }))
    .sort((a, b) => (b.matches[0]?.score || 0) - (a.matches[0]?.score || 0) || a.name.localeCompare(b.name));

  return NextResponse.json({
    query,
    product: product ? {
      id: product.id,
      productName: product.product_name,
      brandName: product.brand_name || null,
      productType: product.product_type || null,
      netContents: product.net_contents || null,
      label: [product.brand_name, product.product_name].filter(Boolean).join(' · '),
    } : null,
    count: dispensaries.length,
    dispensaries,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
