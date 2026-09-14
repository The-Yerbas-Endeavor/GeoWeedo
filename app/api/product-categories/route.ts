import { NextResponse } from 'next/server';
import { ensureWeedoFactsSchema } from '@/lib/weedoFacts';
import { ensureWeedoMenuSchema } from '@/lib/weedoMenus';
import { getDatabase } from '@/lib/sqlite';
import { ensureProductCategorySchema, listProductCategories } from '@/lib/productCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  ensureWeedoFactsSchema();
  ensureWeedoMenuSchema();
  const db = getDatabase();
  ensureProductCategorySchema(db);
  return NextResponse.json({ categories: listProductCategories(db) }, { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } });
}
