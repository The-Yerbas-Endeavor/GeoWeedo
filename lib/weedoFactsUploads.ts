import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDatabase } from './sqlite';
import { ensureWeedoMenuSchema } from './weedoMenus';
import type { ScLabsCoaPdfData } from './scLabsCoaPdf';

function ensureSchema() {
  ensureWeedoMenuSchema();
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_coa_uploads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      identifier_type TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      original_filename TEXT,
      stored_path TEXT NOT NULL,
      parsed_json TEXT NOT NULL,
      submission_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, sha256),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(submission_id) REFERENCES cannabis_product_submissions(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS cannabis_coa_uploads_submission_idx ON cannabis_coa_uploads(submission_id);
    CREATE INDEX IF NOT EXISTS cannabis_coa_uploads_sha_idx ON cannabis_coa_uploads(sha256);
  `);
  return db;
}

export function ensureWeedoFactsUploadSchema() { return ensureSchema(); }

function storageRoot() { return path.join(process.cwd(), 'data', 'runtime', 'weedo-facts', 'coa'); }

export function getStoredCoaPath(sha256: string) {
  return path.join(storageRoot(), `${sha256}.pdf`);
}

export function saveCoaUpload(input: {
  userId: string;
  identifierType: string;
  identifierValue: string;
  originalFilename?: string | null;
  bytes: Uint8Array;
  parsed: ScLabsCoaPdfData;
}) {
  const db = ensureSchema();
  const existing = db.prepare('SELECT * FROM cannabis_coa_uploads WHERE user_id=? AND sha256=? LIMIT 1').get(input.userId, input.parsed.sha256) as any;
  if (existing) return existing;

  const root = storageRoot();
  fs.mkdirSync(root, { recursive: true });
  const storedPath = getStoredCoaPath(input.parsed.sha256);
  if (!fs.existsSync(storedPath)) fs.writeFileSync(storedPath, Buffer.from(input.bytes));

  const id = `wfcoa-${randomUUID()}`;
  const now = new Date().toISOString();
  const parsedJson = JSON.stringify(input.parsed);
  db.prepare(`INSERT INTO cannabis_coa_uploads
    (id,user_id,identifier_type,identifier_value,sha256,original_filename,stored_path,parsed_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?, 'pending', ?,?)`)
    .run(id, input.userId, input.identifierType, input.identifierValue, input.parsed.sha256, input.originalFilename || null, storedPath, parsedJson, now, now);
  return db.prepare('SELECT * FROM cannabis_coa_uploads WHERE id=?').get(id) as any;
}

export function getOwnedCoaUpload(userId: string, uploadId: string) {
  const db = ensureSchema();
  return db.prepare('SELECT * FROM cannabis_coa_uploads WHERE id=? AND user_id=? LIMIT 1').get(uploadId, userId) as any;
}

export function attachCoaUploadToSubmission(userId: string, uploadId: string, submissionId: string) {
  const db = ensureSchema();
  const upload = getOwnedCoaUpload(userId, uploadId);
  if (!upload) throw new Error('COA upload was not found for this user.');
  if (upload.submission_id && upload.submission_id !== submissionId) throw new Error('COA upload is already attached to another submission.');
  const now = new Date().toISOString();
  const parsed = JSON.parse(upload.parsed_json || '{}');
  const evidence = JSON.stringify({ type: 'coa_pdf_upload', uploadId: upload.id, sha256: upload.sha256, filename: upload.original_filename, parsed });
  db.prepare(`UPDATE cannabis_product_submissions SET evidence_json=?, updated_at=? WHERE id=? AND submitted_by_user_id=?`).run(evidence, now, submissionId, userId);
  db.prepare(`UPDATE cannabis_coa_uploads SET submission_id=?, status='submitted', updated_at=? WHERE id=? AND user_id=?`).run(submissionId, now, uploadId, userId);
  return upload;
}
