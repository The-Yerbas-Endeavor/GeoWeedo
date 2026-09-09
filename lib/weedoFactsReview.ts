import { randomUUID } from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema, createWeedoFactsProduct } from './weedoFacts';
import { ensureWeedoMenuSchema, addDispensaryMenuItem } from './weedoMenus';

function parseJson(value: unknown) {
  if (!value || typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeStatus(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^pass(ed)?$/i.test(text)) return 'Pass';
  if (/^fail(ed)?$/i.test(text)) return 'Fail';
  return text.slice(0, 80);
}

function ensureIdentifier(db: any, input: { batchId: string; type: string; value: string | null | undefined; now: string }) {
  const value = String(input.value || '').trim();
  if (!value) return;
  const conflict = db.prepare(`SELECT batch_id FROM cannabis_batch_identifiers WHERE identifier_type=? AND identifier_value=? LIMIT 1`)
    .get(input.type, value) as any;
  if (conflict && conflict.batch_id !== input.batchId) {
    throw new Error(`${input.type.toUpperCase()} ${value} is already linked to another batch.`);
  }
  if (conflict) {
    db.prepare(`UPDATE cannabis_batch_identifiers SET verified=1 WHERE identifier_type=? AND identifier_value=? AND batch_id=?`)
      .run(input.type, value, input.batchId);
    return;
  }
  db.prepare(`INSERT INTO cannabis_batch_identifiers (id,batch_id,identifier_type,identifier_value,verified,created_at)
              VALUES (?,?,?,?,1,?)`)
    .run(`cbid-${randomUUID()}`, input.batchId, input.type, value, input.now);
}

function ensureProductIdentifier(db: any, input: { productId: string; type: string; value: string | null | undefined; now: string }) {
  const value = String(input.value || '').trim();
  if (!value) return;
  const conflict = db.prepare(`SELECT product_id FROM cannabis_product_identifiers WHERE identifier_type=? AND identifier_value=? LIMIT 1`)
    .get(input.type, value) as any;
  if (conflict && conflict.product_id !== input.productId) {
    throw new Error(`${input.type.toUpperCase()} ${value} is already linked to another product.`);
  }
  if (conflict) {
    db.prepare(`UPDATE cannabis_product_identifiers SET verified=1, source='admin_coa_review' WHERE identifier_type=? AND identifier_value=? AND product_id=?`)
      .run(input.type, value, input.productId);
    return;
  }
  db.prepare(`INSERT INTO cannabis_product_identifiers (id,product_id,identifier_type,identifier_value,source,verified,created_at)
              VALUES (?,?,?,?, 'admin_coa_review', 1, ?)`)
    .run(`cpid-${randomUUID()}`, input.productId, input.type, value, input.now);
}

function findExistingBatch(db: any, productId: string, input: { uid?: string | null; batchNumber?: string | null; sampleId?: string | null }) {
  if (input.uid) {
    const row = db.prepare(`SELECT * FROM cannabis_batches WHERE uid=? LIMIT 1`).get(input.uid) as any;
    if (row) {
      if (row.product_id !== productId) throw new Error(`UID ${input.uid} is already linked to another product.`);
      return row;
    }
  }
  if (input.sampleId) {
    const row = db.prepare(`SELECT * FROM cannabis_batches WHERE coa_number=? LIMIT 1`).get(input.sampleId) as any;
    if (row) {
      if (row.product_id !== productId) throw new Error(`COA/sample ${input.sampleId} is already linked to another product.`);
      return row;
    }
  }
  if (input.batchNumber) {
    const rows = db.prepare(`SELECT * FROM cannabis_batches WHERE product_id=? AND batch_number=? LIMIT 2`).all(productId, input.batchNumber) as any[];
    if (rows.length === 1) return rows[0];
    if (rows.length > 1) throw new Error(`Batch ${input.batchNumber} is ambiguous for this product.`);
  }
  return null;
}

export function getAdminCoaReviewSubmissions(status = 'pending') {
  ensureWeedoMenuSchema();
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT s.*, u.username, u.display_name AS submitter_display_name,
           d.name AS dispensary_name, d.city AS dispensary_city, d.region AS dispensary_region,
           cu.id AS coa_upload_id, cu.sha256 AS coa_sha256, cu.original_filename AS coa_filename,
           cu.parsed_json AS coa_parsed_json, cu.status AS coa_upload_status, cu.created_at AS coa_uploaded_at
      FROM cannabis_product_submissions s
      JOIN users u ON u.id=s.submitted_by_user_id
      LEFT JOIN dispensaries d ON d.id=s.dispensary_id
      LEFT JOIN cannabis_coa_uploads cu ON cu.submission_id=s.id
     WHERE (?='all' OR s.status=?)
     ORDER BY CASE WHEN cu.id IS NULL THEN 1 ELSE 0 END, s.created_at ASC
     LIMIT 250
  `).all(status, status) as any[];
  return rows.map((row) => ({
    ...row,
    requested_menu_add: Boolean(row.requested_menu_add),
    menu_item: parseJson(row.menu_item_json),
    coa: row.coa_upload_id ? {
      id: row.coa_upload_id,
      sha256: row.coa_sha256,
      filename: row.coa_filename,
      status: row.coa_upload_status,
      uploadedAt: row.coa_uploaded_at,
      parsed: parseJson(row.coa_parsed_json) || {},
    } : null,
  }));
}

export function approveExactBatchFromCoa(input: { submissionId: string; adminId: string; reviewNotes?: string | null }) {
  ensureWeedoFactsSchema();
  ensureWeedoMenuSchema();
  const db = getDatabase();
  const submission = db.prepare(`SELECT * FROM cannabis_product_submissions WHERE id=? LIMIT 1`).get(input.submissionId) as any;
  if (!submission) throw new Error('Submission not found.');
  if (submission.status !== 'pending' && submission.status !== 'needs_info') throw new Error(`Submission is already ${submission.status}.`);

  const upload = db.prepare(`SELECT * FROM cannabis_coa_uploads WHERE submission_id=? LIMIT 1`).get(input.submissionId) as any;
  if (!upload) throw new Error('Exact-batch approval requires an attached COA PDF.');
  const parsed = parseJson(upload.parsed_json) || {};
  if (!upload.sha256 || !parsed.sha256 || upload.sha256 !== parsed.sha256) throw new Error('COA evidence hash is missing or inconsistent.');

  const uid = String(parsed.uid || submission.uid || '').trim() || null;
  const batchNumber = String(parsed.batchNumber || submission.batch_number || '').trim() || null;
  const sampleId = String(parsed.sampleId || '').trim() || null;
  if (!uid && !batchNumber && !sampleId) throw new Error('COA does not expose enough batch identity to verify an exact batch.');

  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    let productId = submission.product_id as string | null;
    if (!productId) {
      const productName = String(submission.product_name || parsed.productName || '').trim();
      if (!productName) throw new Error('Product name is required before exact-batch approval.');
      productId = createWeedoFactsProduct({
        brandName: submission.brand_name || null,
        productName,
        productType: submission.product_type || null,
        netContents: submission.net_contents || null,
      });
    }

    let batch = submission.batch_id ? db.prepare(`SELECT * FROM cannabis_batches WHERE id=?`).get(submission.batch_id) as any : null;
    if (batch && batch.product_id !== productId) throw new Error('Existing submission batch belongs to another product.');
    if (!batch) batch = findExistingBatch(db, productId, { uid, batchNumber, sampleId });

    const batchId = batch?.id || `cb-${randomUUID()}`;
    const overallStatus = normalizeStatus(parsed.overallStatus);
    const sourceUrl = submission.coa_url || submission.source_url || null;

    if (!batch) {
      db.prepare(`INSERT INTO cannabis_batches (
        id,product_id,batch_number,uid,coa_number,coa_url,lab_name,collected_at,received_at,tested_at,overall_status,
        source_type,source_name,source_url,verified,created_at,updated_at
      ) VALUES (?,?,?,?,?,?, 'SC Labs', ?,?,?,?,?, 'SC Labs', ?,1,?,?)`)
        .run(batchId, productId, batchNumber, uid, sampleId, submission.coa_url || null,
          parsed.collectedAt || null, parsed.receivedAt || null, parsed.testedAt || null, overallStatus,
          'lab_coa_pdf', sourceUrl, now, now);
    } else {
      db.prepare(`UPDATE cannabis_batches SET
        batch_number=COALESCE(?,batch_number), uid=COALESCE(?,uid), coa_number=COALESCE(?,coa_number), coa_url=COALESCE(?,coa_url),
        lab_name='SC Labs', collected_at=COALESCE(?,collected_at), received_at=COALESCE(?,received_at), tested_at=COALESCE(?,tested_at),
        overall_status=COALESCE(?,overall_status), source_type='lab_coa_pdf', source_name='SC Labs', source_url=COALESCE(?,source_url),
        verified=1, updated_at=? WHERE id=?`)
        .run(batchNumber, uid, sampleId, submission.coa_url || null, parsed.collectedAt || null, parsed.receivedAt || null,
          parsed.testedAt || null, overallStatus, sourceUrl, now, batchId);
    }

    ensureIdentifier(db, { batchId, type: 'uid', value: uid, now });
    ensureIdentifier(db, { batchId, type: 'batch', value: batchNumber, now });
    ensureIdentifier(db, { batchId, type: 'coa', value: sampleId, now });

    if (submission.identifier_type === 'upc') {
      ensureProductIdentifier(db, { productId, type: 'upc', value: submission.identifier_value, now });
    } else if (['qr','uid','batch','coa'].includes(submission.identifier_type)) {
      ensureIdentifier(db, { batchId, type: submission.identifier_type, value: submission.identifier_value, now });
    }

    const analytes = Array.isArray(parsed.analytes) ? parsed.analytes : [];
    for (const analyte of analytes) {
      const groupName = String(analyte?.groupName || '').trim();
      const analyteName = String(analyte?.analyteName || '').trim();
      if (!groupName || !analyteName) continue;
      db.prepare(`DELETE FROM cannabis_analytes WHERE batch_id=? AND group_name=? AND analyte_name=?`).run(batchId, groupName, analyteName);
      db.prepare(`INSERT INTO cannabis_analytes (id,batch_id,group_name,analyte_name,value,unit,status,created_at)
                  VALUES (?,?,?,?,?,?,?,?)`)
        .run(`ca-${randomUUID()}`, batchId, groupName, analyteName,
          Number.isFinite(Number(analyte.value)) ? Number(analyte.value) : null,
          analyte.unit || null, normalizeStatus(analyte.status), now);
    }

    const externalId = `pdf:${upload.sha256}`;
    const existingSource = db.prepare(`SELECT id FROM cannabis_coa_sources WHERE external_id=? LIMIT 1`).get(externalId) as any;
    const rawPayload = JSON.stringify({ ...parsed, uploadId: upload.id, filename: upload.original_filename || null });
    if (existingSource) {
      db.prepare(`UPDATE cannabis_coa_sources SET batch_id=?,source_type='lab_coa_pdf',source_name='SC Labs',source_url=?,raw_payload_json=?,parser_version='sclabs-coa-pdf-v1',fetched_at=?,verified=1 WHERE id=?`)
        .run(batchId, sourceUrl, rawPayload, now, existingSource.id);
    } else {
      db.prepare(`INSERT INTO cannabis_coa_sources (id,batch_id,source_type,source_name,source_url,external_id,raw_payload_json,parser_version,fetched_at,verified,created_at)
                  VALUES (?,?,'lab_coa_pdf','SC Labs',?,?,?,?,?,1,?)`)
        .run(`coas-${randomUUID()}`, batchId, sourceUrl, externalId, rawPayload, 'sclabs-coa-pdf-v1', now, now);
    }

    let menuItemId: string | null = null;
    const menu = parseJson(submission.menu_item_json);
    if (submission.requested_menu_add && submission.dispensary_id && menu) {
      menuItemId = addDispensaryMenuItem({
        dispensaryId: submission.dispensary_id,
        productId,
        batchId,
        itemName: menu.itemName || submission.product_name || parsed.productName || 'Cannabis product',
        brandName: submission.brand_name || null,
        category: menu.category || submission.product_type || null,
        variant: menu.variant || null,
        packageSize: menu.packageSize || submission.net_contents || null,
        priceCents: Number.isFinite(Number(menu.priceCents)) ? Number(menu.priceCents) : null,
        currency: menu.currency || 'USD',
        inventoryStatus: 'reported',
        sourceType: 'verified_coa_submission',
        sourceUrl,
        verified: true,
      });
    }

    db.prepare(`UPDATE cannabis_product_submissions SET product_id=?,batch_id=?,status='approved',reviewed_by_admin_id=?,reviewed_at=?,review_notes=?,updated_at=? WHERE id=?`)
      .run(productId, batchId, input.adminId, now, input.reviewNotes || null, now, input.submissionId);
    db.prepare(`UPDATE cannabis_coa_uploads SET status='approved',updated_at=? WHERE id=?`).run(now, upload.id);
    db.prepare(`INSERT INTO audit_log (id,actor_type,actor_id,action,entity_type,entity_id,metadata_json,created_at)
                VALUES (?,'admin',?,'weedo_facts.exact_batch_approved','cannabis_product_submission',?,?,?)`)
      .run(`audit-${randomUUID()}`, input.adminId, input.submissionId, JSON.stringify({ productId, batchId, uploadId: upload.id, sha256: upload.sha256, menuItemId }), now);

    db.exec('COMMIT');
    return { productId, batchId, uploadId: upload.id, menuItemId, identifier: uid || sampleId || batchNumber, identifierType: uid ? 'uid' : sampleId ? 'coa' : 'batch' };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function updateCoaReviewStatus(input: { submissionId: string; adminId: string; status: 'rejected' | 'needs_info'; reviewNotes?: string | null }) {
  ensureWeedoMenuSchema();
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`UPDATE cannabis_product_submissions SET status=?,reviewed_by_admin_id=?,reviewed_at=?,review_notes=?,updated_at=? WHERE id=?`)
    .run(input.status, input.adminId, now, input.reviewNotes || null, now, input.submissionId);
  if (!result.changes) throw new Error('Submission not found.');
  db.prepare(`UPDATE cannabis_coa_uploads SET status=?,updated_at=? WHERE submission_id=?`).run(input.status, now, input.submissionId);
  return { status: input.status };
}
