import 'server-only';

import { randomUUID } from 'crypto';
import { getDatabase } from './sqlite';
import { ensureWeedoFactsSchema } from './weedoFacts';

export type CultivarEvidenceType =
  | 'breeder_primary'
  | 'multi_source_confirmed'
  | 'database_reported'
  | 'registrant_reported'
  | 'genetic_dataset'
  | 'editorial'
  | 'community_reported'
  | 'unknown';

export type CultivarClaimStatus =
  | 'verified_source'
  | 'multiple_sources_agree'
  | 'single_source_claim'
  | 'conflicting_pedigree'
  | 'community_reported'
  | 'unknown';

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function normalizeCultivarName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function ensureSchema() {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cannabis_pedigree_cultivars (
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      breeder TEXT,
      cultivar_type TEXT,
      description TEXT,
      origin TEXT,
      status TEXT NOT NULL DEFAULT 'unverified',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cannabis_pedigree_sources (
      id TEXT PRIMARY KEY,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT,
      external_id TEXT,
      evidence_type TEXT NOT NULL DEFAULT 'unknown',
      license_note TEXT,
      raw_payload_json TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cannabis_pedigree_aliases (
      id TEXT PRIMARY KEY,
      cultivar_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      source_id TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(cultivar_id) REFERENCES cannabis_pedigree_cultivars(id) ON DELETE CASCADE,
      FOREIGN KEY(source_id) REFERENCES cannabis_pedigree_sources(id) ON DELETE SET NULL,
      UNIQUE(cultivar_id, normalized_alias)
    );

    CREATE TABLE IF NOT EXISTS cannabis_pedigree_lineage_claims (
      id TEXT PRIMARY KEY,
      child_cultivar_id TEXT NOT NULL,
      parent_cultivar_id TEXT NOT NULL,
      parent_role TEXT NOT NULL DEFAULT 'unknown',
      relationship_type TEXT NOT NULL DEFAULT 'cross',
      generation TEXT,
      source_id TEXT,
      confidence INTEGER NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'single_source_claim',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(child_cultivar_id) REFERENCES cannabis_pedigree_cultivars(id) ON DELETE CASCADE,
      FOREIGN KEY(parent_cultivar_id) REFERENCES cannabis_pedigree_cultivars(id) ON DELETE CASCADE,
      FOREIGN KEY(source_id) REFERENCES cannabis_pedigree_sources(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS cannabis_product_pedigree_cultivars (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      cultivar_id TEXT NOT NULL,
      source_id TEXT,
      confidence INTEGER NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'single_source_claim',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES cannabis_products(id) ON DELETE CASCADE,
      FOREIGN KEY(cultivar_id) REFERENCES cannabis_pedigree_cultivars(id) ON DELETE CASCADE,
      FOREIGN KEY(source_id) REFERENCES cannabis_pedigree_sources(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS cannabis_pedigree_genetic_relationships (
      id TEXT PRIMARY KEY,
      cultivar_a_id TEXT NOT NULL,
      cultivar_b_id TEXT NOT NULL,
      relationship_label TEXT NOT NULL DEFAULT 'genetic_relative',
      similarity_score REAL,
      source_id TEXT NOT NULL,
      evidence_json TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(cultivar_a_id) REFERENCES cannabis_pedigree_cultivars(id) ON DELETE CASCADE,
      FOREIGN KEY(cultivar_b_id) REFERENCES cannabis_pedigree_cultivars(id) ON DELETE CASCADE,
      FOREIGN KEY(source_id) REFERENCES cannabis_pedigree_sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS cannabis_pedigree_cultivars_name_idx ON cannabis_pedigree_cultivars(normalized_name);
    CREATE INDEX IF NOT EXISTS cannabis_pedigree_aliases_name_idx ON cannabis_pedigree_aliases(normalized_alias);
    CREATE INDEX IF NOT EXISTS cannabis_pedigree_lineage_child_idx ON cannabis_pedigree_lineage_claims(child_cultivar_id, confidence DESC);
    CREATE INDEX IF NOT EXISTS cannabis_pedigree_lineage_parent_idx ON cannabis_pedigree_lineage_claims(parent_cultivar_id, confidence DESC);
    CREATE INDEX IF NOT EXISTS cannabis_product_pedigree_product_idx ON cannabis_product_pedigree_cultivars(product_id, confidence DESC);
    CREATE INDEX IF NOT EXISTS cannabis_product_pedigree_cultivar_idx ON cannabis_product_pedigree_cultivars(cultivar_id, confidence DESC);
    CREATE INDEX IF NOT EXISTS cannabis_pedigree_genetic_a_idx ON cannabis_pedigree_genetic_relationships(cultivar_a_id);
    CREATE INDEX IF NOT EXISTS cannabis_pedigree_genetic_b_idx ON cannabis_pedigree_genetic_relationships(cultivar_b_id);
  `);
  return db;
}

export function ensureCultivarGeneticsSchema() {
  ensureSchema();
}

export function createOrEnrichCultivar(input: {
  canonicalName: string;
  breeder?: string | null;
  cultivarType?: string | null;
  description?: string | null;
  origin?: string | null;
  status?: string | null;
}) {
  const db = ensureSchema();
  const canonicalName = String(input.canonicalName || '').trim();
  const normalized = normalizeCultivarName(canonicalName);
  if (!canonicalName || !normalized) throw new Error('Cultivar name is required.');
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM cannabis_pedigree_cultivars WHERE normalized_name=? LIMIT 1').get(normalized) as any;
  if (existing) {
    db.prepare(`UPDATE cannabis_pedigree_cultivars SET
      breeder=CASE WHEN breeder IS NULL OR breeder='' THEN COALESCE(?,breeder) ELSE breeder END,
      cultivar_type=CASE WHEN cultivar_type IS NULL OR cultivar_type='' THEN COALESCE(?,cultivar_type) ELSE cultivar_type END,
      description=CASE WHEN description IS NULL OR description='' THEN COALESCE(?,description) ELSE description END,
      origin=CASE WHEN origin IS NULL OR origin='' THEN COALESCE(?,origin) ELSE origin END,
      status=CASE WHEN status='unverified' THEN COALESCE(?,status) ELSE status END,
      updated_at=? WHERE id=?`)
      .run(clean(input.breeder), clean(input.cultivarType), clean(input.description), clean(input.origin), clean(input.status), now, existing.id);
    return db.prepare('SELECT * FROM cannabis_pedigree_cultivars WHERE id=?').get(existing.id) as any;
  }
  const id = `cultivar-${randomUUID()}`;
  db.prepare(`INSERT INTO cannabis_pedigree_cultivars
    (id,canonical_name,normalized_name,breeder,cultivar_type,description,origin,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, canonicalName, normalized, clean(input.breeder), clean(input.cultivarType), clean(input.description), clean(input.origin), clean(input.status) || 'unverified', now, now);
  return db.prepare('SELECT * FROM cannabis_pedigree_cultivars WHERE id=?').get(id) as any;
}

export function addCultivarSource(input: {
  sourceName: string;
  sourceType: string;
  sourceUrl?: string | null;
  externalId?: string | null;
  evidenceType?: CultivarEvidenceType | string | null;
  licenseNote?: string | null;
  rawPayload?: unknown;
  verified?: boolean;
}) {
  const db = ensureSchema();
  const sourceName = String(input.sourceName || '').trim();
  const sourceType = String(input.sourceType || '').trim();
  if (!sourceName || !sourceType) throw new Error('Source name and source type are required.');
  const sourceUrl = clean(input.sourceUrl);
  const externalId = clean(input.externalId);
  const existing = db.prepare(`SELECT * FROM cannabis_pedigree_sources
    WHERE source_name=? COLLATE NOCASE
      AND COALESCE(source_url,'')=COALESCE(?, '')
      AND COALESCE(external_id,'')=COALESCE(?, '')
    ORDER BY verified DESC, updated_at DESC LIMIT 1`).get(sourceName, sourceUrl, externalId) as any;
  const now = new Date().toISOString();
  const payload = input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload);
  if (existing) {
    db.prepare(`UPDATE cannabis_pedigree_sources SET
      source_type=?, evidence_type=?, license_note=COALESCE(?,license_note),
      raw_payload_json=COALESCE(?,raw_payload_json), verified=MAX(verified,?), updated_at=?
      WHERE id=?`)
      .run(sourceType, clean(input.evidenceType) || 'unknown', clean(input.licenseNote), payload, input.verified ? 1 : 0, now, existing.id);
    return db.prepare('SELECT * FROM cannabis_pedigree_sources WHERE id=?').get(existing.id) as any;
  }
  const id = `cultsrc-${randomUUID()}`;
  db.prepare(`INSERT INTO cannabis_pedigree_sources
    (id,source_name,source_type,source_url,external_id,evidence_type,license_note,raw_payload_json,verified,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, sourceName, sourceType, sourceUrl, externalId, clean(input.evidenceType) || 'unknown', clean(input.licenseNote), payload, input.verified ? 1 : 0, now, now);
  return db.prepare('SELECT * FROM cannabis_pedigree_sources WHERE id=?').get(id) as any;
}

export function addCultivarAlias(input: { cultivarId: string; alias: string; sourceId?: string | null; verified?: boolean }) {
  const db = ensureSchema();
  const alias = String(input.alias || '').trim();
  const normalized = normalizeCultivarName(alias);
  if (!alias || !normalized) throw new Error('Alias is required.');
  const cultivar = db.prepare('SELECT id FROM cannabis_pedigree_cultivars WHERE id=?').get(input.cultivarId);
  if (!cultivar) throw new Error('Cultivar was not found.');
  const existing = db.prepare('SELECT id FROM cannabis_pedigree_aliases WHERE cultivar_id=? AND normalized_alias=?').get(input.cultivarId, normalized) as any;
  if (existing?.id) {
    if (input.verified) db.prepare('UPDATE cannabis_pedigree_aliases SET verified=1 WHERE id=?').run(existing.id);
    return existing.id as string;
  }
  const id = `cultalias-${randomUUID()}`;
  db.prepare(`INSERT INTO cannabis_pedigree_aliases (id,cultivar_id,alias,normalized_alias,source_id,verified,created_at)
    VALUES (?,?,?,?,?,?,?)`)
    .run(id, input.cultivarId, alias, normalized, clean(input.sourceId), input.verified ? 1 : 0, new Date().toISOString());
  return id;
}

export function addLineageClaim(input: {
  childCultivarId: string;
  parentCultivarId: string;
  parentRole?: string | null;
  relationshipType?: string | null;
  generation?: string | null;
  sourceId?: string | null;
  confidence?: number | null;
  status?: CultivarClaimStatus | string | null;
  notes?: string | null;
}) {
  const db = ensureSchema();
  if (input.childCultivarId === input.parentCultivarId) throw new Error('A cultivar cannot be its own parent.');
  const child = db.prepare('SELECT id FROM cannabis_pedigree_cultivars WHERE id=?').get(input.childCultivarId);
  const parent = db.prepare('SELECT id FROM cannabis_pedigree_cultivars WHERE id=?').get(input.parentCultivarId);
  if (!child || !parent) throw new Error('Child and parent cultivars must both exist.');
  const confidence = Math.max(0, Math.min(100, Number(input.confidence ?? 50)));
  const parentRole = clean(input.parentRole) || 'unknown';
  const relationshipType = clean(input.relationshipType) || 'cross';
  const sourceId = clean(input.sourceId);
  const existing = db.prepare(`SELECT id FROM cannabis_pedigree_lineage_claims
    WHERE child_cultivar_id=? AND parent_cultivar_id=? AND parent_role=? AND relationship_type=?
      AND COALESCE(source_id,'')=COALESCE(?, '') LIMIT 1`)
    .get(input.childCultivarId, input.parentCultivarId, parentRole, relationshipType, sourceId) as any;
  const now = new Date().toISOString();
  if (existing?.id) {
    db.prepare(`UPDATE cannabis_pedigree_lineage_claims SET generation=?,confidence=?,status=?,notes=?,updated_at=? WHERE id=?`)
      .run(clean(input.generation), confidence, clean(input.status) || 'single_source_claim', clean(input.notes), now, existing.id);
    return existing.id as string;
  }
  const id = `lineage-${randomUUID()}`;
  db.prepare(`INSERT INTO cannabis_pedigree_lineage_claims
    (id,child_cultivar_id,parent_cultivar_id,parent_role,relationship_type,generation,source_id,confidence,status,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, input.childCultivarId, input.parentCultivarId, parentRole, relationshipType, clean(input.generation), sourceId, confidence, clean(input.status) || 'single_source_claim', clean(input.notes), now, now);
  return id;
}

export function linkProductToCultivar(input: {
  productId: string;
  cultivarId: string;
  sourceId?: string | null;
  confidence?: number | null;
  status?: CultivarClaimStatus | string | null;
  notes?: string | null;
}) {
  const db = ensureSchema();
  const product = db.prepare('SELECT id FROM cannabis_products WHERE id=?').get(input.productId);
  const cultivar = db.prepare('SELECT id FROM cannabis_pedigree_cultivars WHERE id=?').get(input.cultivarId);
  if (!product || !cultivar) throw new Error('Product and cultivar must both exist.');
  const sourceId = clean(input.sourceId);
  const existing = db.prepare(`SELECT id FROM cannabis_product_pedigree_cultivars
    WHERE product_id=? AND cultivar_id=? AND COALESCE(source_id,'')=COALESCE(?, '') LIMIT 1`)
    .get(input.productId, input.cultivarId, sourceId) as any;
  const now = new Date().toISOString();
  const confidence = Math.max(0, Math.min(100, Number(input.confidence ?? 50)));
  if (existing?.id) {
    db.prepare('UPDATE cannabis_product_pedigree_cultivars SET confidence=?,status=?,notes=?,updated_at=? WHERE id=?')
      .run(confidence, clean(input.status) || 'single_source_claim', clean(input.notes), now, existing.id);
    return existing.id as string;
  }
  const id = `prodcult-${randomUUID()}`;
  db.prepare(`INSERT INTO cannabis_product_pedigree_cultivars
    (id,product_id,cultivar_id,source_id,confidence,status,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, input.productId, input.cultivarId, sourceId, confidence, clean(input.status) || 'single_source_claim', clean(input.notes), now, now);
  return id;
}

export function addGeneticRelationship(input: {
  cultivarAId: string;
  cultivarBId: string;
  relationshipLabel?: string | null;
  similarityScore?: number | null;
  sourceId: string;
  evidence?: unknown;
  verified?: boolean;
}) {
  const db = ensureSchema();
  if (input.cultivarAId === input.cultivarBId) throw new Error('Genetic relationship requires two different cultivars.');
  const ids = [input.cultivarAId, input.cultivarBId].sort();
  const source = db.prepare('SELECT id FROM cannabis_pedigree_sources WHERE id=?').get(input.sourceId);
  const a = db.prepare('SELECT id FROM cannabis_pedigree_cultivars WHERE id=?').get(ids[0]);
  const b = db.prepare('SELECT id FROM cannabis_pedigree_cultivars WHERE id=?').get(ids[1]);
  if (!source || !a || !b) throw new Error('Both cultivars and the genetic source must exist.');
  const label = clean(input.relationshipLabel) || 'genetic_relative';
  const existing = db.prepare(`SELECT id FROM cannabis_pedigree_genetic_relationships
    WHERE cultivar_a_id=? AND cultivar_b_id=? AND relationship_label=? AND source_id=? LIMIT 1`)
    .get(ids[0], ids[1], label, input.sourceId) as any;
  const score = input.similarityScore === null || input.similarityScore === undefined ? null : Number(input.similarityScore);
  const now = new Date().toISOString();
  const evidenceJson = input.evidence === undefined ? null : JSON.stringify(input.evidence);
  if (existing?.id) {
    db.prepare(`UPDATE cannabis_pedigree_genetic_relationships SET similarity_score=?,evidence_json=COALESCE(?,evidence_json),verified=MAX(verified,?),updated_at=? WHERE id=?`)
      .run(Number.isFinite(score as number) ? score : null, evidenceJson, input.verified ? 1 : 0, now, existing.id);
    return existing.id as string;
  }
  const id = `genrel-${randomUUID()}`;
  db.prepare(`INSERT INTO cannabis_pedigree_genetic_relationships
    (id,cultivar_a_id,cultivar_b_id,relationship_label,similarity_score,source_id,evidence_json,verified,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ids[0], ids[1], label, Number.isFinite(score as number) ? score : null, input.sourceId, evidenceJson, input.verified ? 1 : 0, now, now);
  return id;
}

export function listCultivarGeneticsAdmin(search = '') {
  const db = ensureSchema();
  const q = normalizeCultivarName(search);
  const where = q ? `WHERE c.normalized_name LIKE ? OR EXISTS (SELECT 1 FROM cannabis_pedigree_aliases a WHERE a.cultivar_id=c.id AND a.normalized_alias LIKE ?)` : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  const cultivars = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM cannabis_pedigree_aliases a WHERE a.cultivar_id=c.id) AS alias_count,
      (SELECT COUNT(*) FROM cannabis_pedigree_lineage_claims l WHERE l.child_cultivar_id=c.id) AS parent_claim_count,
      (SELECT COUNT(*) FROM cannabis_pedigree_lineage_claims l WHERE l.parent_cultivar_id=c.id) AS child_claim_count,
      (SELECT COUNT(*) FROM cannabis_product_pedigree_cultivars pc WHERE pc.cultivar_id=c.id) AS product_count
    FROM cannabis_pedigree_cultivars c ${where}
    ORDER BY c.canonical_name COLLATE NOCASE LIMIT 500`).all(...params) as any[];
  const sources = db.prepare('SELECT * FROM cannabis_pedigree_sources ORDER BY verified DESC, source_name COLLATE NOCASE LIMIT 500').all() as any[];
  const lineage = db.prepare(`
    SELECT l.*, child.canonical_name AS child_name, parent.canonical_name AS parent_name,
           s.source_name, s.evidence_type, s.source_url
    FROM cannabis_pedigree_lineage_claims l
    JOIN cannabis_pedigree_cultivars child ON child.id=l.child_cultivar_id
    JOIN cannabis_pedigree_cultivars parent ON parent.id=l.parent_cultivar_id
    LEFT JOIN cannabis_pedigree_sources s ON s.id=l.source_id
    ORDER BY l.updated_at DESC LIMIT 500`).all() as any[];
  const productLinks = db.prepare(`
    SELECT pc.*, p.brand_name, p.product_name, c.canonical_name AS cultivar_name,
           s.source_name, s.source_url
    FROM cannabis_product_pedigree_cultivars pc
    JOIN cannabis_products p ON p.id=pc.product_id
    JOIN cannabis_pedigree_cultivars c ON c.id=pc.cultivar_id
    LEFT JOIN cannabis_pedigree_sources s ON s.id=pc.source_id
    ORDER BY pc.updated_at DESC LIMIT 500`).all() as any[];
  const geneticRelationships = db.prepare(`
    SELECT g.*, a.canonical_name AS cultivar_a_name, b.canonical_name AS cultivar_b_name,
           s.source_name, s.source_url, s.evidence_type
    FROM cannabis_pedigree_genetic_relationships g
    JOIN cannabis_pedigree_cultivars a ON a.id=g.cultivar_a_id
    JOIN cannabis_pedigree_cultivars b ON b.id=g.cultivar_b_id
    JOIN cannabis_pedigree_sources s ON s.id=g.source_id
    ORDER BY g.updated_at DESC LIMIT 500`).all() as any[];
  const products = db.prepare('SELECT id,brand_name,product_name,product_type,net_contents FROM cannabis_products ORDER BY updated_at DESC LIMIT 500').all() as any[];
  const stats = {
    cultivars: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_pedigree_cultivars').get() as any)?.n || 0),
    aliases: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_pedigree_aliases').get() as any)?.n || 0),
    lineageClaims: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_pedigree_lineage_claims').get() as any)?.n || 0),
    sources: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_pedigree_sources').get() as any)?.n || 0),
    productLinks: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_product_pedigree_cultivars').get() as any)?.n || 0),
    geneticRelationships: Number((db.prepare('SELECT COUNT(*) AS n FROM cannabis_pedigree_genetic_relationships').get() as any)?.n || 0),
  };
  return { stats, cultivars, sources, lineage, productLinks, geneticRelationships, products };
}
