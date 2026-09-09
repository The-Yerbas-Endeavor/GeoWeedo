import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';

function numericRange(values: Array<number | null | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!numbers.length) return null;
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

function normalizeName(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function getWeedoFactsBatchHistory(productId: string) {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const product = db.prepare(`SELECT id,brand_name,product_name,product_type,net_contents FROM cannabis_products WHERE id=? LIMIT 1`).get(productId) as any;
  if (!product) return null;

  const batches = db.prepare(`
    SELECT id,batch_number,uid,coa_number,coa_url,lab_name,collected_at,received_at,tested_at,overall_status,
           source_type,source_name,source_url,verified
      FROM cannabis_batches
     WHERE product_id=? AND verified=1
     ORDER BY COALESCE(tested_at,collected_at,created_at) DESC
  `).all(productId) as any[];

  const batchIds = batches.map(row => row.id);
  const analytes = batchIds.length
    ? db.prepare(`SELECT batch_id,group_name,analyte_name,value,unit,status FROM cannabis_analytes WHERE batch_id IN (${batchIds.map(() => '?').join(',')}) ORDER BY batch_id,group_name,analyte_name`).all(...batchIds) as any[]
    : [];

  const byBatch = new Map<string, any[]>();
  for (const row of analytes) {
    const list = byBatch.get(row.batch_id) || [];
    list.push(row);
    byBatch.set(row.batch_id, list);
  }

  const history = batches.map(batch => {
    const rows = byBatch.get(batch.id) || [];
    const cannabinoids = rows.filter(row => row.group_name === 'cannabinoid');
    const terpenes = rows.filter(row => row.group_name === 'terpene');
    const thc = cannabinoids.find(row => normalizeName(row.analyte_name) === 'thc');
    const thca = cannabinoids.find(row => normalizeName(row.analyte_name) === 'thca');
    const totalThc = cannabinoids.find(row => ['totalthc','thctotal'].includes(normalizeName(row.analyte_name))) || thc || thca || null;
    const terpeneTotal = terpenes.reduce((sum, row) => typeof row.value === 'number' && Number.isFinite(row.value) ? sum + row.value : sum, 0);
    const dominant = terpenes
      .filter(row => typeof row.value === 'number' && Number.isFinite(row.value))
      .sort((a, b) => Number(b.value) - Number(a.value))
      .slice(0, 3)
      .map(row => ({ name: row.analyte_name, value: row.value, unit: row.unit }));
    return {
      ...batch,
      verified: Boolean(batch.verified),
      totalThc: totalThc ? { value: totalThc.value, unit: totalThc.unit } : null,
      terpeneTotal: terpenes.length ? { value: terpeneTotal, unit: terpenes.find(row => row.unit)?.unit || null } : null,
      dominantTerpenes: dominant,
    };
  });

  const thcRange = numericRange(history.map(row => row.totalThc?.value));
  const terpeneRange = numericRange(history.map(row => row.terpeneTotal?.value));
  const terpeneCounts = new Map<string, { name: string; count: number }>();
  for (const row of history) {
    for (const terpene of row.dominantTerpenes || []) {
      const key = normalizeName(terpene.name);
      const current = terpeneCounts.get(key) || { name: terpene.name, count: 0 };
      current.count += 1;
      terpeneCounts.set(key, current);
    }
  }

  return {
    product: {
      id: product.id,
      brandName: product.brand_name,
      productName: product.product_name,
      productType: product.product_type,
      netContents: product.net_contents,
    },
    summary: {
      verifiedBatchCount: history.length,
      thcRange,
      terpeneRange,
      dominantTerpenes: [...terpeneCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5),
    },
    batches: history,
  };
}
