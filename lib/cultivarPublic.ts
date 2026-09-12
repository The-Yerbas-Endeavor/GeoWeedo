import 'server-only';

import { getDatabase } from './sqlite';
import { ensureCultivarGeneticsSchema, normalizeCultivarName } from './cultivarPedigree';

export type CultivarGraphNode = {
  id: string;
  name: string;
  slug: string;
  level: number;
  status: string;
  breeder: string | null;
};

export type CultivarLineageEdge = {
  id: string;
  childId: string;
  parentId: string;
  parentRole: string;
  relationshipType: string;
  generation: string | null;
  confidence: number;
  status: string;
  sourceName: string | null;
  sourceUrl: string | null;
  evidenceType: string | null;
};

export type CultivarGeneticEdge = {
  id: string;
  cultivarAId: string;
  cultivarBId: string;
  relationshipLabel: string;
  similarityScore: number | null;
  verified: boolean;
  sourceName: string;
  sourceUrl: string | null;
  evidenceType: string;
};

export function cultivarSlug(name: string) {
  return normalizeCultivarName(name).replace(/\s+/g, '-');
}

function normalizedFromRef(value: string) {
  return normalizeCultivarName(decodeURIComponent(value).replace(/-/g, ' '));
}

function isPublicStatus(value: unknown) {
  return ['source_backed', 'verified', 'conflicting'].includes(String(value || '').toLowerCase());
}

function graphNode(row: any, level: number): CultivarGraphNode {
  return {
    id: String(row.id),
    name: String(row.canonical_name),
    slug: cultivarSlug(String(row.canonical_name)),
    level,
    status: String(row.status || 'unverified'),
    breeder: row.breeder || null,
  };
}

function lineageRow(row: any): CultivarLineageEdge {
  return {
    id: String(row.id),
    childId: String(row.child_cultivar_id),
    parentId: String(row.parent_cultivar_id),
    parentRole: String(row.parent_role || 'unknown'),
    relationshipType: String(row.relationship_type || 'cross'),
    generation: row.generation || null,
    confidence: Number(row.confidence || 0),
    status: String(row.status || 'unknown'),
    sourceName: row.source_name || null,
    sourceUrl: row.source_url || null,
    evidenceType: row.evidence_type || null,
  };
}

function geneticRow(row: any): CultivarGeneticEdge {
  return {
    id: String(row.id),
    cultivarAId: String(row.cultivar_a_id),
    cultivarBId: String(row.cultivar_b_id),
    relationshipLabel: String(row.relationship_label || 'genetic_relative'),
    similarityScore: row.similarity_score === null || row.similarity_score === undefined ? null : Number(row.similarity_score),
    verified: Boolean(row.verified),
    sourceName: String(row.source_name || 'Genetic dataset'),
    sourceUrl: row.source_url || null,
    evidenceType: String(row.evidence_type || 'genetic_dataset'),
  };
}

export function listPublicCultivars(search = '') {
  ensureCultivarGeneticsSchema();
  const db = getDatabase();
  const q = normalizeCultivarName(search);
  const params: string[] = [];
  let filter = `c.status IN ('source_backed','verified','conflicting')`;
  if (q) {
    filter += ` AND (c.normalized_name LIKE ? OR EXISTS (
      SELECT 1 FROM cannabis_pedigree_aliases a
      WHERE a.cultivar_id=c.id AND a.normalized_alias LIKE ?
    ))`;
    params.push(`%${q}%`, `%${q}%`);
  }
  return (db.prepare(`
    SELECT c.id,c.canonical_name,c.breeder,c.cultivar_type,c.origin,c.status,c.updated_at,
      (SELECT COUNT(*) FROM cannabis_pedigree_aliases a WHERE a.cultivar_id=c.id) AS alias_count,
      (SELECT COUNT(*) FROM cannabis_pedigree_lineage_claims l WHERE l.child_cultivar_id=c.id) AS parent_claim_count,
      (SELECT COUNT(*) FROM cannabis_pedigree_lineage_claims l WHERE l.parent_cultivar_id=c.id) AS child_claim_count,
      (SELECT COUNT(*) FROM cannabis_product_pedigree_cultivars pc WHERE pc.cultivar_id=c.id) AS product_count
    FROM cannabis_pedigree_cultivars c
    WHERE ${filter}
    ORDER BY c.canonical_name COLLATE NOCASE
    LIMIT 1000
  `).all(...params) as any[]).map(row => ({ ...row, slug: cultivarSlug(String(row.canonical_name)) }));
}

export function getProductCultivars(productId: string) {
  ensureCultivarGeneticsSchema();
  const db = getDatabase();
  return (db.prepare(`
    SELECT pc.id,pc.confidence,pc.status AS link_status,pc.notes,
           c.id AS cultivar_id,c.canonical_name,c.breeder,c.cultivar_type,c.origin,c.status AS cultivar_status,
           s.source_name,s.source_url,s.evidence_type
    FROM cannabis_product_pedigree_cultivars pc
    JOIN cannabis_pedigree_cultivars c ON c.id=pc.cultivar_id
    LEFT JOIN cannabis_pedigree_sources s ON s.id=pc.source_id
    WHERE pc.product_id=? AND c.status IN ('source_backed','verified','conflicting')
    ORDER BY pc.confidence DESC, c.canonical_name COLLATE NOCASE
  `).all(productId) as any[]).map(row => ({ ...row, slug: cultivarSlug(String(row.canonical_name)) }));
}

export function getPublicCultivar(reference: string) {
  ensureCultivarGeneticsSchema();
  const db = getDatabase();
  const normalized = normalizedFromRef(reference);
  const cultivar = db.prepare(`
    SELECT * FROM cannabis_pedigree_cultivars
    WHERE (id=? OR normalized_name=?)
      AND status IN ('source_backed','verified','conflicting')
    LIMIT 1
  `).get(reference, normalized) as any;
  if (!cultivar || !isPublicStatus(cultivar.status)) return null;

  const aliases = db.prepare(`
    SELECT a.*,s.source_name,s.source_url,s.evidence_type
    FROM cannabis_pedigree_aliases a
    LEFT JOIN cannabis_pedigree_sources s ON s.id=a.source_id
    WHERE a.cultivar_id=?
    ORDER BY a.verified DESC,a.alias COLLATE NOCASE
  `).all(cultivar.id) as any[];

  const parents = db.prepare(`
    SELECT l.*,p.canonical_name AS parent_name,p.breeder AS parent_breeder,p.status AS parent_status,
           s.source_name,s.source_url,s.evidence_type
    FROM cannabis_pedigree_lineage_claims l
    JOIN cannabis_pedigree_cultivars p ON p.id=l.parent_cultivar_id
    LEFT JOIN cannabis_pedigree_sources s ON s.id=l.source_id
    WHERE l.child_cultivar_id=?
    ORDER BY l.confidence DESC,l.parent_role,l.updated_at DESC
  `).all(cultivar.id) as any[];

  const children = db.prepare(`
    SELECT l.*,c.canonical_name AS child_name,c.breeder AS child_breeder,c.status AS child_status,
           s.source_name,s.source_url,s.evidence_type
    FROM cannabis_pedigree_lineage_claims l
    JOIN cannabis_pedigree_cultivars c ON c.id=l.child_cultivar_id
    LEFT JOIN cannabis_pedigree_sources s ON s.id=l.source_id
    WHERE l.parent_cultivar_id=?
    ORDER BY l.confidence DESC,c.canonical_name COLLATE NOCASE
  `).all(cultivar.id) as any[];

  const products = db.prepare(`
    SELECT pc.*,p.brand_name,p.product_name,p.product_type,p.net_contents,
           s.source_name,s.source_url,s.evidence_type
    FROM cannabis_product_pedigree_cultivars pc
    JOIN cannabis_products p ON p.id=pc.product_id
    LEFT JOIN cannabis_pedigree_sources s ON s.id=pc.source_id
    WHERE pc.cultivar_id=?
    ORDER BY pc.confidence DESC,p.product_name COLLATE NOCASE
  `).all(cultivar.id) as any[];

  const geneticRelationships = db.prepare(`
    SELECT g.*,a.canonical_name AS cultivar_a_name,b.canonical_name AS cultivar_b_name,
           s.source_name,s.source_url,s.evidence_type
    FROM cannabis_pedigree_genetic_relationships g
    JOIN cannabis_pedigree_cultivars a ON a.id=g.cultivar_a_id
    JOIN cannabis_pedigree_cultivars b ON b.id=g.cultivar_b_id
    JOIN cannabis_pedigree_sources s ON s.id=g.source_id
    WHERE g.cultivar_a_id=? OR g.cultivar_b_id=?
    ORDER BY g.verified DESC,g.similarity_score DESC,g.updated_at DESC
  `).all(cultivar.id, cultivar.id) as any[];

  const nodeMap = new Map<string, CultivarGraphNode>();
  const edgeMap = new Map<string, CultivarLineageEdge>();
  nodeMap.set(String(cultivar.id), graphNode(cultivar, 0));

  const parentStatement = db.prepare(`
    SELECT l.*,p.id,p.canonical_name,p.breeder,p.status,s.source_name,s.source_url,s.evidence_type
    FROM cannabis_pedigree_lineage_claims l
    JOIN cannabis_pedigree_cultivars p ON p.id=l.parent_cultivar_id
    LEFT JOIN cannabis_pedigree_sources s ON s.id=l.source_id
    WHERE l.child_cultivar_id=?
    ORDER BY l.confidence DESC,l.updated_at DESC
  `);
  let frontier = [String(cultivar.id)];
  for (let depth = 1; depth <= 3 && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const childId of frontier) {
      const rows = parentStatement.all(childId) as any[];
      for (const row of rows) {
        const parentId = String(row.parent_cultivar_id);
        const existing = nodeMap.get(parentId);
        if (!existing || existing.level > -depth) nodeMap.set(parentId, graphNode({ ...row, id: parentId }, -depth));
        edgeMap.set(String(row.id), lineageRow(row));
        if (!next.includes(parentId)) next.push(parentId);
      }
    }
    frontier = next;
  }

  const childStatement = db.prepare(`
    SELECT l.*,c.id,c.canonical_name,c.breeder,c.status,s.source_name,s.source_url,s.evidence_type
    FROM cannabis_pedigree_lineage_claims l
    JOIN cannabis_pedigree_cultivars c ON c.id=l.child_cultivar_id
    LEFT JOIN cannabis_pedigree_sources s ON s.id=l.source_id
    WHERE l.parent_cultivar_id=?
    ORDER BY l.confidence DESC,l.updated_at DESC
  `);
  frontier = [String(cultivar.id)];
  for (let depth = 1; depth <= 2 && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const parentId of frontier) {
      const rows = childStatement.all(parentId) as any[];
      for (const row of rows) {
        const childId = String(row.child_cultivar_id);
        const existing = nodeMap.get(childId);
        if (!existing || existing.level < depth) nodeMap.set(childId, graphNode({ ...row, id: childId }, depth));
        edgeMap.set(String(row.id), lineageRow(row));
        if (!next.includes(childId)) next.push(childId);
      }
    }
    frontier = next;
  }

  const geneticEdges = geneticRelationships.map(geneticRow);
  for (const relation of geneticRelationships) {
    const otherId = String(relation.cultivar_a_id) === String(cultivar.id) ? String(relation.cultivar_b_id) : String(relation.cultivar_a_id);
    const otherName = String(relation.cultivar_a_id) === String(cultivar.id) ? relation.cultivar_b_name : relation.cultivar_a_name;
    if (!nodeMap.has(otherId)) {
      const other = db.prepare('SELECT id,canonical_name,breeder,status FROM cannabis_pedigree_cultivars WHERE id=? LIMIT 1').get(otherId) as any;
      if (other) nodeMap.set(otherId, graphNode({ ...other, canonical_name: otherName || other.canonical_name }, 99));
    }
  }

  return {
    cultivar: { ...cultivar, slug: cultivarSlug(String(cultivar.canonical_name)) },
    aliases,
    parents: parents.map(row => ({ ...row, parent_slug: cultivarSlug(String(row.parent_name)) })),
    children: children.map(row => ({ ...row, child_slug: cultivarSlug(String(row.child_name)) })),
    products,
    geneticRelationships: geneticRelationships.map(row => ({
      ...row,
      other_cultivar_id: String(row.cultivar_a_id) === String(cultivar.id) ? row.cultivar_b_id : row.cultivar_a_id,
      other_cultivar_name: String(row.cultivar_a_id) === String(cultivar.id) ? row.cultivar_b_name : row.cultivar_a_name,
      other_slug: cultivarSlug(String(String(row.cultivar_a_id) === String(cultivar.id) ? row.cultivar_b_name : row.cultivar_a_name)),
    })),
    graph: {
      focusId: String(cultivar.id),
      nodes: [...nodeMap.values()],
      lineageEdges: [...edgeMap.values()],
      geneticEdges,
    },
  };
}
