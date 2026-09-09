import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';

type ReviewSubmission = {
  product_id?: string | null;
  brand_name?: string | null;
  product_name?: string | null;
  batch_number?: string | null;
  uid?: string | null;
  coa?: { parsed?: Record<string, any> | null } | null;
};

function text(value: unknown) {
  return String(value || '').trim();
}

export function getWeedoFactsReviewMatchPreview(submission: ReviewSubmission) {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const parsed = submission.coa?.parsed || {};
  const productName = text(submission.product_name || parsed.productName);
  const brandName = text(submission.brand_name);
  const uid = text(parsed.uid || submission.uid);
  const sampleId = text(parsed.sampleId);
  const batchNumber = text(parsed.batchNumber || submission.batch_number);

  const productCandidates: any[] = [];
  const seenProducts = new Set<string>();
  const addProduct = (row: any, reason: string) => {
    if (!row || seenProducts.has(row.id)) return;
    seenProducts.add(row.id);
    productCandidates.push({
      id: row.id,
      brandName: row.brand_name,
      productName: row.product_name,
      productType: row.product_type,
      reason,
    });
  };

  if (submission.product_id) {
    addProduct(db.prepare(`SELECT * FROM cannabis_products WHERE id=? LIMIT 1`).get(submission.product_id) as any, 'Already linked by submission');
  }

  if (productName) {
    const rows = brandName
      ? db.prepare(`SELECT * FROM cannabis_products WHERE product_name=? COLLATE NOCASE AND brand_name=? COLLATE NOCASE LIMIT 5`).all(productName, brandName) as any[]
      : db.prepare(`SELECT * FROM cannabis_products WHERE product_name=? COLLATE NOCASE LIMIT 5`).all(productName) as any[];
    for (const row of rows) addProduct(row, brandName ? 'Same brand + product name' : 'Same product name');
  }

  const batchCandidates = new Map<string, any>();
  const addBatchRows = (rows: any[], reason: string) => {
    for (const row of rows) {
      const existing = batchCandidates.get(row.id);
      if (existing) {
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        continue;
      }
      batchCandidates.set(row.id, {
        id: row.id,
        productId: row.product_id,
        brandName: row.brand_name,
        productName: row.product_name,
        batchNumber: row.batch_number,
        uid: row.uid,
        coaNumber: row.coa_number,
        verified: Boolean(row.verified),
        sourceType: row.source_type,
        reasons: [reason],
      });
    }
  };

  const baseQuery = `SELECT b.*,p.brand_name,p.product_name FROM cannabis_batches b JOIN cannabis_products p ON p.id=b.product_id WHERE `;
  if (uid) addBatchRows(db.prepare(`${baseQuery} b.uid=? LIMIT 5`).all(uid) as any[], `UID ${uid}`);
  if (sampleId) addBatchRows(db.prepare(`${baseQuery} b.coa_number=? LIMIT 5`).all(sampleId) as any[], `COA/sample ${sampleId}`);
  if (batchNumber) addBatchRows(db.prepare(`${baseQuery} b.batch_number=? LIMIT 10`).all(batchNumber) as any[], `Batch ${batchNumber}`);

  const batches = [...batchCandidates.values()];
  const likelyProductIds = new Set(productCandidates.map(row => row.id));
  const conflicts = batches.filter(row => likelyProductIds.size > 0 && !likelyProductIds.has(row.productId));

  return {
    identifiers: { uid: uid || null, sampleId: sampleId || null, batchNumber: batchNumber || null },
    productCandidates,
    batchCandidates: batches,
    hasPotentialConflict: conflicts.length > 0,
    conflictBatchIds: conflicts.map(row => row.id),
  };
}
