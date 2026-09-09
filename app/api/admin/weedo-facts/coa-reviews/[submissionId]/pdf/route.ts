import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import { getDatabase } from '@/lib/sqlite';
import { ensureWeedoFactsUploadSchema } from '@/lib/weedoFactsUploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ submissionId: string }> }) {
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  ensureWeedoFactsUploadSchema();
  const { submissionId } = await context.params;
  const db = getDatabase();
  const upload = db.prepare(`SELECT original_filename,sha256 FROM cannabis_coa_uploads WHERE submission_id=? LIMIT 1`).get(submissionId) as any;
  if (!upload?.sha256 || !/^[a-f0-9]{64}$/i.test(upload.sha256)) return NextResponse.json({ error: 'COA PDF not found.' }, { status: 404 });

  const root = path.resolve(process.cwd(), 'data', 'runtime', 'weedo-facts', 'coa');
  const resolved = path.join(root, `${upload.sha256}.pdf`);
  if (!fs.existsSync(resolved)) return NextResponse.json({ error: 'COA PDF is missing from storage.' }, { status: 404 });

  const bytes = fs.readFileSync(resolved);
  const safeName = String(upload.original_filename || 'coa.pdf').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
