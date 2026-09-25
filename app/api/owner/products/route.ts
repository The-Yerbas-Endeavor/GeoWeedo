import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/userAuth';
import { userOwnerCanEdit } from '@/lib/dispensaryCommunity';
import { addDispensaryMenuItem, ensureWeedoMenuSchema, listDispensaryMenu } from '@/lib/weedoMenus';
import { listProductCategories } from '@/lib/productCategories';
import { getDatabase } from '@/lib/sqlite';
import { ensureWeedoCoreSchema } from '@/lib/weedoCore';
import { resolveCanonicalProductId } from '@/lib/productMaintenance';

export const runtime = 'nodejs';

function cleanText(value: unknown, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function cents(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(10_000_000, Math.round(parsed)));
}

function ensureOwnerScanColumns(db: ReturnType<typeof getDatabase>) {
  const columns = db.prepare('PRAGMA table_info(dispensary_menu_items)').all() as Array<{name?:string}>;
  const names = new Set(columns.map(column => String(column.name || '')));
  if (!names.has('owner_scan_type')) db.exec('ALTER TABLE dispensary_menu_items ADD COLUMN owner_scan_type TEXT');
  if (!names.has('owner_scan_value')) db.exec('ALTER TABLE dispensary_menu_items ADD COLUMN owner_scan_value TEXT');
  if (!names.has('owner_user_id')) db.exec('ALTER TABLE dispensary_menu_items ADD COLUMN owner_user_id TEXT');
}

function normalizedScanType(value: unknown, scanValue: string) {
  const supplied = cleanText(value, 24).toLowerCase();
  if (['qr','upc','barcode'].includes(supplied)) return supplied;
  if (/^https?:\/\//i.test(scanValue)) return 'qr';
  if (/^\d{8,14}$/.test(scanValue.replace(/[\s-]/g,''))) return 'upc';
  return 'barcode';
}

function ownerAccess(request: NextRequest, locationId: string) {
  const user = getUserFromRequest(request);
  if (!user) return { error: NextResponse.json({ error: 'Sign in required.' }, { status: 401 }) } as const;
  if (!locationId || !userOwnerCanEdit(user.id, locationId)) {
    return { error: NextResponse.json({ error: 'You are not verified to edit this dispensary.' }, { status: 403 }) } as const;
  }
  return { user } as const;
}

function setOwnerProductLinkState(
  db: ReturnType<typeof getDatabase>,
  itemId: string,
  userId: string,
  productId: string | null,
  previouslyLinked = false,
) {
  const now = new Date().toISOString();
  if (productId) {
    db.prepare(`
      UPDATE dispensary_menu_items
         SET owner_user_id=?,
             product_id=?,
             suggested_product_id=NULL,
             match_confidence='high',
             match_score=100,
             match_reason='verified dispensary owner linked canonical GeoWeedo product',
             matched_at=?,
             match_review_status='confirmed',
             match_reviewed_at=?,
             match_reviewed_by=NULL,
             verified=1,
             active=1,
             updated_at=?
       WHERE id=?
    `).run(userId, productId, now, now, now, itemId);
    return;
  }

  db.prepare(`
    UPDATE dispensary_menu_items
       SET owner_user_id=?,
           product_id=NULL,
           batch_id=NULL,
           suggested_product_id=NULL,
           match_confidence='unmatched',
           match_score=0,
           match_reason=?,
           matched_at=?,
           match_review_status=?,
           match_reviewed_at=?,
           match_reviewed_by=NULL,
           verified=1,
           active=1,
           updated_at=?
     WHERE id=?
  `).run(
    userId,
    previouslyLinked ? 'verified dispensary owner explicitly unlinked canonical product' : 'verified dispensary owner added unlinked menu item',
    now,
    previouslyLinked ? 'rejected' : 'unmatched',
    previouslyLinked ? now : null,
    now,
    itemId,
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const locationId = cleanText(searchParams.get('locationId'), 160);
  const access = ownerAccess(request, locationId);
  if ('error' in access) return access.error;

  ensureWeedoMenuSchema();
  ensureWeedoCoreSchema();
  const db = getDatabase();
  ensureOwnerScanColumns(db);
  const query = cleanText(searchParams.get('q'), 120);
  if (query) {
    const like = `%${query.replace(/[%_]/g, '')}%`;
    const products = db.prepare(`
      SELECT p.id,p.product_name AS productName,p.brand_name AS brandName,p.product_type AS productType,
             p.category_id AS categoryId,c.name AS categoryName
        FROM cannabis_products p
        LEFT JOIN cannabis_product_categories c ON c.id=p.category_id
       WHERE p.product_name LIKE ? COLLATE NOCASE OR COALESCE(p.brand_name,'') LIKE ? COLLATE NOCASE
       ORDER BY CASE WHEN p.product_name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
                p.product_name COLLATE NOCASE,COALESCE(p.brand_name,'') COLLATE NOCASE
       LIMIT 24
    `).all(like, like, `${query.replace(/[%_]/g, '')}%`) as any[];
    return NextResponse.json({ products }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({
    items: listDispensaryMenu(locationId),
    categories: listProductCategories(db),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const locationId = cleanText(body?.locationId, 160);
  const access = ownerAccess(request, locationId);
  if ('error' in access) return access.error;

  const itemName = cleanText(body?.itemName, 240);
  if (!itemName) return NextResponse.json({ error: 'Product name is required.' }, { status: 400 });

  try {
    ensureWeedoMenuSchema();
    ensureWeedoCoreSchema();
    const db = getDatabase();
    ensureOwnerScanColumns(db);
    const suppliedProductId = cleanText(body?.productId, 180) || null;
    const productId = suppliedProductId ? resolveCanonicalProductId(suppliedProductId, db) : null;
    const scanValue = cleanText(body?.scanValue, 512);
    const scanType = scanValue ? normalizedScanType(body?.identifierType, scanValue) : null;
    if (scanValue) {
      const duplicate = db.prepare(`
        SELECT mi.id
        FROM dispensary_menu_items mi
        JOIN dispensary_menus m ON m.id=mi.menu_id
        WHERE m.dispensary_id=? AND m.active=1 AND mi.active=1
          AND mi.owner_scan_type=? AND mi.owner_scan_value=?
        LIMIT 1
      `).get(locationId, scanType, scanValue) as any;
      if (duplicate?.id) {
        if (productId) setOwnerProductLinkState(db, String(duplicate.id), access.user.id, productId, true);
        const item = listDispensaryMenu(locationId).find((row: any) => row.id === duplicate.id) || null;
        return NextResponse.json({ ok: true, alreadyExists: true, item });
      }
    }
    const id = addDispensaryMenuItem({
      dispensaryId: locationId,
      productId,
      itemName,
      brandName: cleanText(body?.brandName, 180) || null,
      categoryId: cleanText(body?.categoryId, 120) || null,
      category: cleanText(body?.category, 180) || null,
      categorySource: 'owner',
      variant: cleanText(body?.variant, 160) || null,
      packageSize: cleanText(body?.packageSize, 120) || null,
      priceCents: cents(body?.priceCents),
      currency: 'USD',
      inventoryStatus: cleanText(body?.inventoryStatus, 40) || 'in_stock',
      sourceType: scanValue ? (productId ? 'verified_owner_scan' : 'owner_reported_scan') : 'owner',
      sourceUrl: /^https?:\/\//i.test(scanValue) ? scanValue : null,
      verified: true,
    });
    if (scanValue) {
      db.prepare('UPDATE dispensary_menu_items SET owner_scan_type=?,owner_scan_value=?,updated_at=? WHERE id=?')
        .run(scanType, scanValue, new Date().toISOString(), id);
    }
    setOwnerProductLinkState(db, id, access.user.id, productId, false);
    const item = listDispensaryMenu(locationId).find((row: any) => row.id === id) || null;
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not add product.' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const locationId = cleanText(body?.locationId, 160);
  const itemId = cleanText(body?.itemId, 180);
  const access = ownerAccess(request, locationId);
  if ('error' in access) return access.error;
  if (!itemId) return NextResponse.json({ error: 'itemId is required.' }, { status: 400 });

  ensureWeedoMenuSchema();
  ensureWeedoCoreSchema();
  const db = getDatabase();
  ensureOwnerScanColumns(db);
  const existing = db.prepare(`
    SELECT mi.id,mi.product_id FROM dispensary_menu_items mi
    JOIN dispensary_menus m ON m.id=mi.menu_id
    WHERE mi.id=? AND m.dispensary_id=? LIMIT 1
  `).get(itemId, locationId) as any;
  if (!existing) return NextResponse.json({ error: 'Product listing was not found.' }, { status: 404 });

  const itemName = cleanText(body?.itemName, 240);
  if (!itemName) return NextResponse.json({ error: 'Product name is required.' }, { status: 400 });
  const suppliedProductId = cleanText(body?.productId, 180) || null;
  const productId = suppliedProductId ? resolveCanonicalProductId(suppliedProductId, db) : null;
  let categoryId = cleanText(body?.categoryId, 120) || null;
  let categorySource = 'owner';
  if (productId) {
    const product = db.prepare('SELECT id,category_id FROM cannabis_products WHERE id=? LIMIT 1').get(productId) as any;
    if (!product) return NextResponse.json({ error: 'Linked GeoWeedo product was not found.' }, { status: 400 });
    if (product.category_id) {
      categoryId = String(product.category_id);
      categorySource = 'product';
    }
  }

  const scanValue = cleanText(body?.scanValue, 512);
  const scanType = scanValue ? normalizedScanType(body?.identifierType, scanValue) : null;
  db.prepare(`
    UPDATE dispensary_menu_items
       SET product_id=?,item_name=?,brand_name=?,category_id=?,category_source=?,variant=?,package_size=?,
           price_cents=?,currency='USD',inventory_status=?,
           source_type=CASE WHEN ?<>'' THEN ? ELSE source_type END,
           source_url=CASE WHEN ? LIKE 'http%' THEN ? ELSE source_url END,
           owner_scan_type=CASE WHEN ?<>'' THEN ? ELSE owner_scan_type END,
           owner_scan_value=CASE WHEN ?<>'' THEN ? ELSE owner_scan_value END,
           verified=1,active=1,updated_at=?
     WHERE id=?
  `).run(
    productId,
    itemName,
    cleanText(body?.brandName, 180) || null,
    categoryId,
    categorySource,
    cleanText(body?.variant, 160) || null,
    cleanText(body?.packageSize, 120) || null,
    cents(body?.priceCents),
    cleanText(body?.inventoryStatus, 40) || 'in_stock',
    scanValue,
    scanValue ? (productId ? 'verified_owner_scan' : 'owner_reported_scan') : 'owner',
    scanValue,
    scanValue,
    scanValue,
    scanType,
    scanValue,
    scanValue,
    new Date().toISOString(),
    itemId,
  );

  setOwnerProductLinkState(db, itemId, access.user.id, productId, Boolean(existing.product_id));

  const item = listDispensaryMenu(locationId).find((row: any) => row.id === itemId) || null;
  return NextResponse.json({ ok: true, item });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const locationId = cleanText(body?.locationId, 160);
  const action = cleanText(body?.action, 64);
  const access = ownerAccess(request, locationId);
  if ('error' in access) return access.error;

  ensureWeedoMenuSchema();
  ensureWeedoCoreSchema();
  const db = getDatabase();
  ensureOwnerScanColumns(db);

  const now = new Date().toISOString();

  if (action === 'confirm-current') {
    const result = db.prepare(`
      UPDATE dispensary_menu_items
         SET source_type=CASE
               WHEN source_type IN ('verified_owner_scan','owner_reported_scan') THEN source_type
               ELSE 'owner'
             END,
             source_updated_at=?,
             verified=1,
             updated_at=?
       WHERE active=1
         AND inventory_status<>'out_of_stock'
         AND menu_id IN (
           SELECT id FROM dispensary_menus
           WHERE dispensary_id=? AND active=1
         )
    `).run(now, now, locationId);

    return NextResponse.json({
      ok: true,
      action,
      updated: Number(result.changes || 0),
      confirmedAt: now,
      message: `${Number(result.changes || 0)} current product listing${Number(result.changes || 0)===1?'':'s'} confirmed.`,
    });
  }

  if (action === 'mark-all-unavailable') {
    const result = db.prepare(`
      UPDATE dispensary_menu_items
         SET inventory_status='out_of_stock',
             source_type=CASE
               WHEN source_type IN ('verified_owner_scan','owner_reported_scan') THEN source_type
               ELSE 'owner'
             END,
             source_updated_at=?,
             verified=1,
             updated_at=?
       WHERE active=1
         AND inventory_status<>'out_of_stock'
         AND menu_id IN (
           SELECT id FROM dispensary_menus
           WHERE dispensary_id=? AND active=1
         )
    `).run(now, now, locationId);

    return NextResponse.json({
      ok: true,
      action,
      updated: Number(result.changes || 0),
      confirmedAt: now,
      message: `${Number(result.changes || 0)} product listing${Number(result.changes || 0)===1?'':'s'} marked unavailable.`,
    });
  }

  return NextResponse.json({ error: 'Unknown bulk product action.' }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const locationId = cleanText(searchParams.get('locationId'), 160);
  const itemId = cleanText(searchParams.get('itemId'), 180);
  const access = ownerAccess(request, locationId);
  if ('error' in access) return access.error;
  if (!itemId) return NextResponse.json({ error: 'itemId is required.' }, { status: 400 });

  ensureWeedoMenuSchema();
  ensureWeedoCoreSchema();
  const db = getDatabase();
  ensureOwnerScanColumns(db);
  const result = db.prepare(`
    UPDATE dispensary_menu_items
       SET active=0,updated_at=?
     WHERE id=? AND menu_id IN (SELECT id FROM dispensary_menus WHERE dispensary_id=? AND active=1)
  `).run(new Date().toISOString(), itemId, locationId);
  if (!Number(result.changes || 0)) return NextResponse.json({ error: 'Product listing was not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
