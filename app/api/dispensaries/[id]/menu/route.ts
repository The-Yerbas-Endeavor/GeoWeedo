import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { listDispensaryMenu } from '@/lib/weedoMenus';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const db = getDatabase();
    const dispensary = db.prepare(`SELECT id, name, slug, city, region, country, active, verified FROM dispensaries WHERE id = ? LIMIT 1`).get(id) as any;
    if (!dispensary || !dispensary.active) return NextResponse.json({ error: 'Dispensary not found.' }, { status: 404 });

    const items = listDispensaryMenu(id).map((item: any) => ({
      id: item.id,
      productId: item.product_id,
      batchId: item.batch_id,
      name: item.item_name,
      brandName: item.brand_name,
      category: item.category,
      variant: item.variant,
      packageSize: item.package_size,
      priceCents: item.price_cents,
      currency: item.currency,
      inventoryStatus: item.inventory_status,
      sourceType: item.source_type,
      sourceUrl: item.source_url,
      sourceUpdatedAt: item.source_updated_at,
      verified: Boolean(item.verified),
      weedoFacts: item.product_id ? {
        available: Boolean(item.batch_id),
        exactBatch: Boolean(item.batch_id && item.linked_batch_verified),
        batchNumber: item.linked_batch_number || null,
        uid: item.linked_uid || null,
        complianceStatus: item.linked_batch_status || null,
      } : null,
    }));

    return NextResponse.json({
      dispensary: {
        id: dispensary.id,
        name: dispensary.name,
        slug: dispensary.slug,
        city: dispensary.city,
        region: dispensary.region,
        country: dispensary.country,
        verified: Boolean(dispensary.verified),
      },
      items,
      count: items.length,
    });
  } catch (error) {
    console.error('[dispensary menu]', error);
    return NextResponse.json({ error: 'Unable to load menu.' }, { status: 500 });
  }
}
