import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';
import { ensureProductCategorySchema } from './productCategories';

export type ProductCategorySummary = {
  id: string;
  slug: string;
  name: string;
};

export function getProductCategorySummary(productId: string): ProductCategorySummary | null {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  ensureProductCategorySchema(db);
  return (db.prepare(`
    SELECT c.id,c.slug,c.name
    FROM cannabis_products p
    JOIN cannabis_product_categories c ON c.id=p.category_id AND c.active=1
    WHERE p.id=?
    LIMIT 1
  `).get(productId) as ProductCategorySummary | undefined) || null;
}
