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
    const totalThc = cannabinoids.find(row => ['totalthc','thctotal'].includes(normalizeName(row.analyte_name))) || thc || null;

    const terpeneRows = terpenes.filter(row => typeof row.value === 'number' && Number.isFinite(row.value));
    const terpeneUnits = new Set(terpeneRows.map(row => String(row.unit || '').trim()).filter(Boolean));
    const terpeneTotal = terpeneRows.length && terpeneUnits.size <= 1
      ? { value: terpeneRows.reduce((sum, row) => sum + Number(row.value), 0), unit: terpeneRows[0]?.unit || null }
      : null;

    const dominant = terpeneRows
      .slice()
      .sort((a, b) => Number(b.value) - Number(a.value))
      .slice(0, 3)
      .map(row => ({ name: row.analyte_name, value: row.value, unit: row.unit }));

    return {
      ...batch,
      verified: Boolean(batch.verified),
      totalThc: totalThc ? { value: totalThc.value, unit: totalThc.unit } : null,
      terpeneTotal,
      dominantTerpenes: dominant,
    };
  });

  const thcUnits = new Set(history.map(row => String(row.totalThc?.unit || '').trim()).filter(Boolean));
  const terpeneUnits = new Set(history.map(row => String(row.terpeneTotal?.unit || '').trim()).filter(Boolean));
  const thcRange = thcUnits.size <= 1 ? numericRange(history.map(row => row.totalThc?.value)) : null;
  const terpeneRange = terpeneUnits.size <= 1 ? numericRange(history.map(row => row.terpeneTotal?.value)) : null;
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
      thcUnit: thcUnits.size === 1 ? [...thcUnits][0] : null,
      terpeneRange,
      terpeneUnit: terpeneUnits.size === 1 ? [...terpeneUnits][0] : null,
      dominantTerpenes: [...terpeneCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5),
    },
    batches: history,
  };
}
