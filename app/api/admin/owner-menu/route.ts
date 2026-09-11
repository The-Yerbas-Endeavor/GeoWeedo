import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { addDispensaryMenuItem, ensureWeedoMenuSchema, listDispensaryMenu } from '@/lib/weedoMenus';
import { ensureWeedoFactsSchema } from '@/lib/weedoFacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
function forbidden(message = 'Forbidden.') { return NextResponse.json({ error: message }, { status: 403 }); }
function invalid(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }
function text(value: unknown) { return String(value ?? '').trim(); }
function optional(value: unknown) { const valueText = text(value); return valueText || null; }

function ensure() {
  ensureWeedoFactsSchema();
  ensureWeedoMenuSchema();
  return getDatabase();
}

function ownerAssignment(db: ReturnType<typeof getDatabase>, adminId: string, dispensaryId: string) {
  return db.prepare(`
    SELECT o.location_id, d.name, d.city, d.region
    FROM dispensary_owner_assignments o
    JOIN dispensaries d ON d.id=o.location_id
    WHERE o.admin_user_id=?
      AND o.location_id=?
      AND o.status='verified'
      AND d.active=1
      AND d.verified=1
    LIMIT 1
  `).get(adminId, dispensaryId) as any;
}

function ownerLocations(db: ReturnType<typeof getDatabase>, adminId: string) {
  return db.prepare(`
    SELECT o.location_id, d.name, d.city, d.region
    FROM dispensary_owner_assignments o
    JOIN dispensaries d ON d.id=o.location_id
    WHERE o.admin_user_id=?
      AND o.status='verified'
      AND d.active=1
      AND d.verified=1
    ORDER BY d.name COLLATE NOCASE
  `).all(adminId) as any[];
}

export async function GET(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return unauthorized();
  if (admin.role !== 'verified_dispensary') return forbidden('Verified dispensary owner/operator access is required.');

  const db = ensure();
  const locations = ownerLocations(db, admin.id);
  const requested = text(request.nextUrl.searchParams.get('dispensaryId'));
  const selected = requested || String(locations[0]?.location_id || '');
  if (!selected) return NextResponse.json({ locations, menuItems: [] }, { headers: { 'Cache-Control': 'no-store' } });
  if (!ownerAssignment(db, admin.id, selected)) return forbidden('This dispensary is not assigned to your account.');

  return NextResponse.json({
    locations,
    dispensaryId: selected,
    menuItems: listDispensaryMenu(selected),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return unauthorized();
  if (admin.role !== 'verified_dispensary') return forbidden('Verified dispensary owner/operator access is required.');

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return invalid('Invalid JSON body.');

  const dispensaryId = text((body as any).dispensaryId);
  const productId = text((body as any).productId);
  const batchId = optional((body as any).batchId);
  const scanValue = text((body as any).scanValue);
  const itemName = text((body as any).itemName);
  const brandName = optional((body as any).brandName);
  const category = optional((body as any).category);
  const variant = optional((body as any).variant);
  const packageSize = optional((body as any).packageSize);
  const inventoryStatus = optional((body as any).inventoryStatus) || 'in_stock';
  const sourceUrl = optional((body as any).sourceUrl) || (/^https?:\/\//i.test(scanValue) ? scanValue : null);
  const priceRaw = text((body as any).price);

  if (!dispensaryId) return invalid('Dispensary is required.');
  if (!productId) return invalid('A resolved GeoWeedo product is required. Scan or look up the product first.');
  if (!itemName) return invalid('Menu item name is required.');
  if (!scanValue) return invalid('The scanned QR value is required.');

  const db = ensure();
  const assignment = ownerAssignment(db, admin.id, dispensaryId);
  if (!assignment) return forbidden('This dispensary is not assigned to your account.');

  const product = db.prepare(`
    SELECT id,brand_name,product_name,product_type,net_contents
    FROM cannabis_products WHERE id=? LIMIT 1
  `).get(productId) as any;
  if (!product) return invalid('The scanned product is not present in the GeoWeedo product database.');

  let batch: any = null;
  if (batchId) {
    batch = db.prepare(`
      SELECT id,product_id,batch_number,uid,verified,source_type
      FROM cannabis_batches WHERE id=? LIMIT 1
    `).get(batchId) as any;
    if (!batch || batch.product_id !== productId) return invalid('The scanned batch is not linked to this product.');
  }

  const price = priceRaw ? Number(priceRaw) : null;
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100000)) {
    return invalid('Price must be a valid non-negative amount.');
  }
  if (!['in_stock', 'low_stock', 'unknown', 'out_of_stock'].includes(inventoryStatus)) {
    return invalid('Invalid inventory status.');
  }

  // A stable external key makes repeated scans of the same exact batch update
  // the existing owner menu item rather than creating duplicates.
  const externalItemId = `owner-scan:${batchId || productId}`;
  const itemId = addDispensaryMenuItem({
    dispensaryId,
    productId,
    batchId,
    externalItemId,
    itemName,
    brandName: brandName || product.brand_name || null,
    category: category || product.product_type || null,
    variant,
    packageSize: packageSize || product.net_contents || null,
    priceCents: price === null ? null : Math.round(price * 100),
    currency: 'USD',
    inventoryStatus,
    sourceType: 'verified_owner_scan',
    sourceUrl,
    sourceUpdatedAt: new Date().toISOString(),
    verified: true,
  });

  return NextResponse.json({
    ok: true,
    itemId,
    dispensary: assignment,
    product: {
      id: product.id,
      productName: product.product_name,
      brandName: product.brand_name,
      batchId: batch?.id || null,
      batchNumber: batch?.batch_number || null,
      uid: batch?.uid || null,
      verifiedLabBatch: Boolean(batch?.verified === 1 && String(batch?.source_type || '').toLowerCase() === 'lab'),
    },
    menuItems: listDispensaryMenu(dispensaryId),
  }, { status: 201 });
}
