import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { ensureWeedoMenuSchema, listDispensaryMenu } from '@/lib/weedoMenus';
import { assignMenuItemCategory, ensureProductCategorySchema } from '@/lib/productCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown) { return String(value ?? '').trim(); }
function unauthorized() { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
function forbidden(message = 'Forbidden.') { return NextResponse.json({ error: message }, { status: 403 }); }
function invalid(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }

export async function POST(request: NextRequest) {
  const admin = getAdminFromRequest(request);
  if (!admin) return unauthorized();
  if (admin.role !== 'verified_dispensary') return forbidden('Verified dispensary owner/operator access is required.');

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return invalid('Invalid JSON body.');
  const dispensaryId = text((body as any).dispensaryId);
  const itemId = text((body as any).itemId);
  const categoryId = text((body as any).categoryId);
  if (!dispensaryId || !itemId || !categoryId) return invalid('Dispensary, menu item and category are required.');

  ensureWeedoMenuSchema();
  const db = getDatabase();
  ensureProductCategorySchema(db);

  const owned = db.prepare(`
    SELECT mi.id
    FROM dispensary_menu_items mi
    JOIN dispensary_menus m ON m.id=mi.menu_id
    JOIN dispensary_owner_assignments o ON o.location_id=m.dispensary_id
    WHERE mi.id=? AND m.dispensary_id=? AND o.admin_user_id=? AND o.status='verified'
    LIMIT 1
  `).get(itemId, dispensaryId, admin.id) as any;
  if (!owned) return forbidden('This menu item is not assigned to your dispensary.');

  try {
    const category = assignMenuItemCategory(itemId, categoryId, 'owner', db);
    return NextResponse.json({ ok: true, category, menuItems: listDispensaryMenu(dispensaryId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Could not update the menu category.');
  }
}
