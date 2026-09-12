import { NextRequest, NextResponse } from 'next/server';
import { getAdminFromRequest } from '@/lib/adminAuth';
import {
  addCultivarAlias,
  addCultivarSource,
  addGeneticRelationship,
  addLineageClaim,
  createOrEnrichCultivar,
  linkProductToCultivar,
  listCultivarGeneticsAdmin,
} from '@/lib/cultivarGenetics';
import { bulkImportCultivarDataset } from '@/lib/cultivarImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
function invalid(message: string) { return NextResponse.json({ error: message }, { status: 400 }); }
function text(value: unknown) { return String(value ?? '').trim(); }
function optional(value: unknown) { const valueText = text(value); return valueText || null; }
function bool(value: unknown) { return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'; }
function confidence(value: unknown) {
  if (value === null || value === undefined || value === '') return 50;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
}

export async function GET(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const q = text(request.nextUrl.searchParams.get('q'));
  return NextResponse.json(listCultivarGeneticsAdmin(q), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!getAdminFromRequest(request)) return unauthorized();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return invalid('Invalid JSON body.');
  const action = text((body as any).action);

  try {
    let createdId: string | null = null;
    let importResult: any = null;

    if (action === 'create-cultivar') {
      const canonicalName = text((body as any).canonicalName);
      if (!canonicalName) return invalid('Cultivar name is required.');
      const cultivar = createOrEnrichCultivar({
        canonicalName,
        breeder: optional((body as any).breeder),
        cultivarType: optional((body as any).cultivarType),
        description: optional((body as any).description),
        origin: optional((body as any).origin),
        status: optional((body as any).status) || 'unverified',
      });
      createdId = String(cultivar.id);
    } else if (action === 'add-source') {
      const sourceName = text((body as any).sourceName);
      const sourceType = text((body as any).sourceType);
      if (!sourceName || !sourceType) return invalid('Source name and type are required.');
      const source = addCultivarSource({
        sourceName,
        sourceType,
        sourceUrl: optional((body as any).sourceUrl),
        externalId: optional((body as any).externalId),
        evidenceType: optional((body as any).evidenceType) || 'unknown',
        licenseNote: optional((body as any).licenseNote),
        verified: bool((body as any).verified),
      });
      createdId = String(source.id);
    } else if (action === 'add-alias') {
      const cultivarId = text((body as any).cultivarId);
      const alias = text((body as any).alias);
      if (!cultivarId || !alias) return invalid('Cultivar and alias are required.');
      createdId = addCultivarAlias({
        cultivarId,
        alias,
        sourceId: optional((body as any).sourceId),
        verified: bool((body as any).verified),
      });
    } else if (action === 'add-lineage') {
      const childCultivarId = text((body as any).childCultivarId);
      const parentCultivarId = text((body as any).parentCultivarId);
      if (!childCultivarId || !parentCultivarId) return invalid('Child and parent cultivars are required.');
      createdId = addLineageClaim({
        childCultivarId,
        parentCultivarId,
        parentRole: optional((body as any).parentRole) || 'unknown',
        relationshipType: optional((body as any).relationshipType) || 'cross',
        generation: optional((body as any).generation),
        sourceId: optional((body as any).sourceId),
        confidence: confidence((body as any).confidence),
        status: optional((body as any).status) || 'single_source_claim',
        notes: optional((body as any).notes),
      });
    } else if (action === 'link-product') {
      const productId = text((body as any).productId);
      const cultivarId = text((body as any).cultivarId);
      if (!productId || !cultivarId) return invalid('Product and cultivar are required.');
      createdId = linkProductToCultivar({
        productId,
        cultivarId,
        sourceId: optional((body as any).sourceId),
        confidence: confidence((body as any).confidence),
        status: optional((body as any).status) || 'single_source_claim',
        notes: optional((body as any).notes),
      });
    } else if (action === 'add-genetic-relationship') {
      const cultivarAId = text((body as any).cultivarAId);
      const cultivarBId = text((body as any).cultivarBId);
      const sourceId = text((body as any).sourceId);
      if (!cultivarAId || !cultivarBId || !sourceId) return invalid('Both cultivars and a genetic-data source are required.');
      const scoreRaw = (body as any).similarityScore;
      const similarityScore = scoreRaw === '' || scoreRaw === null || scoreRaw === undefined ? null : Number(scoreRaw);
      if (similarityScore !== null && !Number.isFinite(similarityScore)) return invalid('Similarity score must be numeric.');
      createdId = addGeneticRelationship({
        cultivarAId,
        cultivarBId,
        relationshipLabel: optional((body as any).relationshipLabel) || 'genetic_relative',
        similarityScore,
        sourceId,
        verified: bool((body as any).verified),
      });
    } else if (action === 'bulk-import') {
      const dataset = (body as any).dataset;
      if (!dataset || typeof dataset !== 'object') return invalid('A cultivar import dataset is required.');
      importResult = bulkImportCultivarDataset(dataset);
    } else {
      return invalid('Unknown action.');
    }

    return NextResponse.json({ ok: true, createdId, importResult, data: listCultivarGeneticsAdmin() }, { status: 201 });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Cultivar genetics update failed.');
  }
}
