import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/sqlite';
import { ensureWeedoFactsSchema } from '@/lib/weedoFacts';
import { listWeedoFactsAvailability } from '@/lib/weedoFactsAvailability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const productId = String(request.nextUrl.searchParams.get('productId') || '').trim();
  const batchId = String(request.nextUrl.searchParams.get('batchId') || '').trim() || null;
  if (!productId) return NextResponse.json({ error: 'productId is required.' }, { status: 400 });

  ensureWeedoFactsSchema();
  const db = getDatabase();
  const product = db.prepare('SELECT id, brand_name, product_name, product_type, net_contents FROM cannabis_products WHERE id=? LIMIT 1').get(productId) as any;
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });

  if (batchId) {
    const batch = db.prepare('SELECT id FROM cannabis_batches WHERE id=? AND product_id=? LIMIT 1').get(batchId, productId) as any;
    if (!batch) return NextResponse.json({ error: 'Batch does not belong to this product.' }, { status: 400 });
  }

  const items = listWeedoFactsAvailability(productId, batchId);
  return NextResponse.json({
    product: {
      id: product.id,
      brandName: product.brand_name || null,
      productName: product.product_name,
      productType: product.product_type || null,
      netContents: product.net_contents || null,
    },
    batchId,
    count: items.length,
    exactBatchCount: items.filter(item => item.exactBatch).length,
    items,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
