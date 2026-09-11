import 'server-only';

import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';

export type VerifiedProductDatabaseWrite = {
  saved: true;
  productId: string;
  batchId: string;
  verified: true;
  sourceType: 'lab';
  analyteCount: number;
  coaSourceCount: number;
  productName: string;
  batchNumber: string | null;
  uid: string | null;
  coaNumber: string | null;
  labName: string | null;
  overallStatus: string | null;
};

/**
 * Verified QR/COA adapters write through their source-specific ingestion layer.
 * This function is the shared postcondition: never report a verified scan as
 * successful unless the canonical product, verified lab batch, and chemistry
 * rows can be read back from the product database.
 */
export function confirmVerifiedProductDatabaseWrite(
  productId: string | null | undefined,
  batchId: string | null | undefined,
): VerifiedProductDatabaseWrite {
  ensureWeedoFactsSchema();
  if (!productId || !batchId) {
    throw new Error('Verified COA did not produce a canonical product and batch.');
  }

  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      p.id AS product_id,
      p.product_name,
      b.id AS batch_id,
      b.batch_number,
      b.uid,
      b.coa_number,
      b.lab_name,
      b.overall_status,
      b.source_type,
      b.verified,
      (SELECT COUNT(*) FROM cannabis_analytes a WHERE a.batch_id=b.id) AS analyte_count,
      (SELECT COUNT(*) FROM cannabis_coa_sources s WHERE s.batch_id=b.id AND s.verified=1) AS coa_source_count
    FROM cannabis_products p
    JOIN cannabis_batches b ON b.product_id=p.id
    WHERE p.id=? AND b.id=?
    LIMIT 1
  `).get(productId, batchId) as any;

  if (!row) throw new Error('Verified COA product database write could not be read back.');
  if (Number(row.verified) !== 1 || String(row.source_type || '').toLowerCase() !== 'lab') {
    throw new Error('Verified COA batch was not promoted to verified lab evidence.');
  }
  const analyteCount = Number(row.analyte_count || 0);
  if (analyteCount < 1) {
    throw new Error('Verified COA did not persist any lab results to the product database.');
  }
  const coaSourceCount = Number(row.coa_source_count || 0);
  if (coaSourceCount < 1) {
    throw new Error('Verified COA did not persist source provenance to the product database.');
  }

  return {
    saved: true,
    productId: String(row.product_id),
    batchId: String(row.batch_id),
    verified: true,
    sourceType: 'lab',
    analyteCount,
    coaSourceCount,
    productName: String(row.product_name),
    batchNumber: row.batch_number ? String(row.batch_number) : null,
    uid: row.uid ? String(row.uid) : null,
    coaNumber: row.coa_number ? String(row.coa_number) : null,
    labName: row.lab_name ? String(row.lab_name) : null,
    overallStatus: row.overall_status ? String(row.overall_status) : null,
  };
}
