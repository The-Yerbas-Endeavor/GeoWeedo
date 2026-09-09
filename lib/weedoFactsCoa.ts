import { randomUUID } from 'crypto';
import { getDatabase } from './sqlite.ts';
import { ensureWeedoFactsSchema } from './weedoFacts.ts';
import type { ScLabsCoaPdfData } from './scLabsCoaPdf.ts';

export function enrichScLabsBatchFromCoa(pdf: ScLabsCoaPdfData, expectedSampleId?: string | null) {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const sampleId = (expectedSampleId || pdf.sampleId || '').trim();
  if (!sampleId) throw new Error('COA does not expose a sample ID and no expected sample ID was supplied.');
  if (expectedSampleId && pdf.sampleId && expectedSampleId.toLowerCase() !== pdf.sampleId.toLowerCase()) {
    throw new Error(`COA sample ID ${pdf.sampleId} does not match expected sample ${expectedSampleId}.`);
  }

  const batch = db.prepare(`
    SELECT b.* FROM cannabis_batches b
    LEFT JOIN cannabis_batch_identifiers i ON i.batch_id=b.id
    WHERE b.source_name='SC Labs'
      AND (b.coa_number=? OR i.identifier_value=?)
    ORDER BY b.verified DESC, b.updated_at DESC
    LIMIT 1
  `).get(sampleId, sampleId) as any;
  if (!batch) throw new Error(`No existing SC Labs Weedo Facts batch matches sample ${sampleId}. Ingest the public SC Labs page first.`);

  const now = new Date().toISOString();
  db.prepare(`UPDATE cannabis_batches SET
      batch_number=COALESCE(?,batch_number),
      uid=COALESCE(?,uid),
      collected_at=COALESCE(?,collected_at),
      received_at=COALESCE(?,received_at),
      tested_at=COALESCE(?,tested_at),
      overall_status=COALESCE(?,overall_status),
      verified=1,
      updated_at=?
    WHERE id=?`).run(
      pdf.batchNumber || null,
      pdf.uid || null,
      pdf.collectedAt || null,
      pdf.receivedAt || null,
      pdf.testedAt || null,
      pdf.overallStatus ? (/^pass/i.test(pdf.overallStatus) ? 'Pass' : /^fail/i.test(pdf.overallStatus) ? 'Fail' : pdf.overallStatus) : null,
      now,
      batch.id,
    );

  const identifier = db.prepare(`INSERT OR IGNORE INTO cannabis_batch_identifiers
    (id,batch_id,identifier_type,identifier_value,verified,created_at) VALUES (?,?,?,?,1,?)`);
  if (pdf.batchNumber) identifier.run(`cbi-${randomUUID()}`, batch.id, 'batch', pdf.batchNumber, now);
  if (pdf.uid) identifier.run(`cbi-${randomUUID()}`, batch.id, 'uid', pdf.uid, now);

  const removeAnalyte = db.prepare(`DELETE FROM cannabis_analytes WHERE batch_id=? AND group_name=? AND lower(analyte_name)=lower(?)`);
  const addAnalyte = db.prepare(`INSERT INTO cannabis_analytes
    (id,batch_id,group_name,analyte_name,value,unit,lod,loq,status,limit_value,limit_unit,created_at)
    VALUES (?,?,?,?,?,?,NULL,NULL,?,NULL,NULL,?)`);
  for (const row of pdf.analytes) {
    removeAnalyte.run(batch.id, row.groupName, row.analyteName);
    addAnalyte.run(`ca-${randomUUID()}`, batch.id, row.groupName, row.analyteName, row.value, row.unit, row.status || null, now);
  }

  const alreadyStored = db.prepare(`SELECT id FROM cannabis_coa_sources WHERE batch_id=? AND source_name='SC Labs' AND external_id=? LIMIT 1`).get(batch.id, `pdf:${pdf.sha256}`) as any;
  if (!alreadyStored) {
    db.prepare(`INSERT INTO cannabis_coa_sources
      (id,batch_id,source_type,source_name,source_url,external_id,raw_payload_json,parser_version,fetched_at,verified,created_at)
      VALUES (?,?,'lab_coa_pdf','SC Labs',NULL,?,?, 'sclabs-coa-pdf-v1',?,1,?)`).run(
        `coa-${randomUUID()}`,
        batch.id,
        `pdf:${pdf.sha256}`,
        JSON.stringify({
          sha256: pdf.sha256,
          sampleId: pdf.sampleId,
          productName: pdf.productName,
          batchNumber: pdf.batchNumber,
          uid: pdf.uid,
          collectedAt: pdf.collectedAt,
          receivedAt: pdf.receivedAt,
          testedAt: pdf.testedAt,
          overallStatus: pdf.overallStatus,
          analyteCount: pdf.analytes.length,
        }),
        now,
        now,
      );
  }

  return {
    batchId: batch.id,
    sampleId,
    batchNumber: pdf.batchNumber,
    uid: pdf.uid,
    analyteCount: pdf.analytes.length,
    pdfSha256: pdf.sha256,
  };
}
