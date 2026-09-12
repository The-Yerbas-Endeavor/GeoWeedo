import 'server-only';

import { getDatabase } from './sqlite';
import {
  addCultivarAlias,
  addCultivarSource,
  addLineageClaim,
  createOrEnrichCultivar,
  ensureCultivarGeneticsSchema,
  normalizeCultivarName,
} from './cultivarGenetics';

type ImportCultivar = {
  name: string;
  breeder?: string | null;
  cultivarType?: string | null;
  description?: string | null;
  origin?: string | null;
  status?: string | null;
  aliases?: string[];
};

type ImportLineage = {
  child: string;
  parent: string;
  parentRole?: string | null;
  relationshipType?: string | null;
  generation?: string | null;
  confidence?: number | null;
  status?: string | null;
  notes?: string | null;
};

type CultivarImportPayload = {
  rightsConfirmed: boolean;
  source: {
    name: string;
    type: string;
    url?: string | null;
    externalId?: string | null;
    evidenceType?: string | null;
    licenseNote: string;
    verified?: boolean;
  };
  cultivars: ImportCultivar[];
  lineage?: ImportLineage[];
};

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function bulkImportCultivarDataset(payload: CultivarImportPayload) {
  ensureCultivarGeneticsSchema();
  if (!payload?.rightsConfirmed) throw new Error('Import blocked: confirm that GeoWeedo has permission or a compatible license to reuse this dataset.');
  if (!payload.source || typeof payload.source !== 'object') throw new Error('Import source metadata is required.');
  const sourceName = String(payload.source.name || '').trim();
  const sourceType = String(payload.source.type || '').trim();
  const licenseNote = String(payload.source.licenseNote || '').trim();
  if (!sourceName || !sourceType) throw new Error('Source name and source type are required.');
  if (licenseNote.length < 8) throw new Error('A meaningful license/reuse note is required before bulk import.');
  if (!Array.isArray(payload.cultivars) || payload.cultivars.length === 0) throw new Error('At least one cultivar is required.');
  if (payload.cultivars.length > 5000) throw new Error('A single import is limited to 5,000 cultivars.');
  const lineage = Array.isArray(payload.lineage) ? payload.lineage : [];
  if (lineage.length > 15000) throw new Error('A single import is limited to 15,000 pedigree claims.');

  const db = getDatabase();
  const ids = new Map<string, string>();
  let cultivarCount = 0;
  let aliasCount = 0;
  let lineageCount = 0;
  let source: any = null;

  db.exec('BEGIN IMMEDIATE');
  try {
    source = addCultivarSource({
      sourceName,
      sourceType,
      sourceUrl: clean(payload.source.url),
      externalId: clean(payload.source.externalId),
      evidenceType: clean(payload.source.evidenceType) || 'unknown',
      licenseNote,
      verified: Boolean(payload.source.verified),
      rawPayload: { importedCultivars: payload.cultivars.length, importedLineageClaims: lineage.length },
    });

    for (const row of payload.cultivars) {
      const name = String(row?.name || '').trim();
      if (!name) throw new Error('Every imported cultivar must have a name.');
      const cultivar = createOrEnrichCultivar({
        canonicalName: name,
        breeder: clean(row.breeder),
        cultivarType: clean(row.cultivarType),
        description: clean(row.description),
        origin: clean(row.origin),
        status: clean(row.status) || (payload.source.verified ? 'source_backed' : 'unverified'),
      });
      ids.set(normalizeCultivarName(name), String(cultivar.id));
      cultivarCount += 1;
      for (const alias of Array.isArray(row.aliases) ? row.aliases : []) {
        const value = String(alias || '').trim();
        if (!value) continue;
        addCultivarAlias({ cultivarId: String(cultivar.id), alias: value, sourceId: String(source.id), verified: Boolean(payload.source.verified) });
        aliasCount += 1;
      }
    }

    for (const row of lineage) {
      const childName = String(row?.child || '').trim();
      const parentName = String(row?.parent || '').trim();
      if (!childName || !parentName) throw new Error('Every pedigree claim requires child and parent names.');
      const childId = ids.get(normalizeCultivarName(childName)) || String((db.prepare('SELECT id FROM cannabis_cultivars WHERE normalized_name=? LIMIT 1').get(normalizeCultivarName(childName)) as any)?.id || '');
      const parentId = ids.get(normalizeCultivarName(parentName)) || String((db.prepare('SELECT id FROM cannabis_cultivars WHERE normalized_name=? LIMIT 1').get(normalizeCultivarName(parentName)) as any)?.id || '');
      if (!childId || !parentId) throw new Error(`Pedigree claim references an unknown cultivar: ${childName} ← ${parentName}.`);
      addLineageClaim({
        childCultivarId: childId,
        parentCultivarId: parentId,
        parentRole: clean(row.parentRole) || 'unknown',
        relationshipType: clean(row.relationshipType) || 'cross',
        generation: clean(row.generation),
        sourceId: String(source.id),
        confidence: row.confidence ?? (payload.source.verified ? 75 : 50),
        status: clean(row.status) || (payload.source.verified ? 'verified_source' : 'single_source_claim'),
        notes: clean(row.notes),
      });
      lineageCount += 1;
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    sourceId: String(source.id),
    sourceName,
    cultivarCount,
    aliasCount,
    lineageCount,
    licenseNote,
  };
}
