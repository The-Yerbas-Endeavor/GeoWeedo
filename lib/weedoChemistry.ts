import { getDatabase } from './sqlite.ts';
import { ensureWeedoFactsSchema } from './weedoFacts.ts';

export type ChemistryKind = 'cannabinoid' | 'terpene';

export type ChemistryProfile = {
  kind: ChemistryKind;
  slug: string;
  name: string;
  aliases: string[];
  chemicalClass: string;
  formula: string;
  molarMass: string;
  overview: string;
  chemistryNotes: string[];
  naturalOccurrence?: string[];
  sensory?: string[];
};

function normalize(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/[αΑ]/g, 'alpha')
    .replace(/[βΒ]/g, 'beta')
    .replace(/[δΔ]/g, 'delta')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const profiles: ChemistryProfile[] = [
  {
    kind: 'cannabinoid', slug: 'thca', name: 'THCA', aliases: ['THCA', 'Delta-9 THCA', 'Δ9-THCA', 'Tetrahydrocannabinolic Acid'],
    chemicalClass: 'Acidic cannabinoid', formula: 'C22H30O4', molarMass: '358.48 g/mol',
    overview: 'Tetrahydrocannabinolic acid (THCA) is an acidic cannabinoid produced by Cannabis. It is the carboxylated precursor of THC.',
    chemistryNotes: ['Contains a carboxylic-acid group that is absent from THC.', 'Heating can remove carbon dioxide from THCA through decarboxylation, producing THC.', 'THCA and THC are separate analytes and should not be treated as interchangeable lab values.'],
  },
  {
    kind: 'cannabinoid', slug: 'thc', name: 'THC', aliases: ['THC', 'Delta-9 THC', 'Δ9-THC', 'D9-THC'],
    chemicalClass: 'Neutral cannabinoid', formula: 'C21H30O2', molarMass: '314.47 g/mol',
    overview: 'Delta-9-tetrahydrocannabinol (THC) is a neutral cannabinoid that can be formed from THCA by decarboxylation.',
    chemistryNotes: ['THC lacks the carboxylic-acid group present in THCA.', 'Laboratories may report THC directly and may separately report THCA.', 'A reported THC value is chemistry data; GeoWeedo does not convert that number into a predicted consumer effect.'],
  },
  {
    kind: 'cannabinoid', slug: 'cbga', name: 'CBGA', aliases: ['CBGA', 'Cannabigerolic Acid'],
    chemicalClass: 'Acidic cannabinoid', formula: 'C22H32O4', molarMass: '360.49 g/mol',
    overview: 'Cannabigerolic acid (CBGA) is an acidic cannabinoid and an important biosynthetic precursor in the cannabinoid pathway.',
    chemistryNotes: ['Plant enzymes can convert CBGA into several other acidic cannabinoids.', 'Decarboxylation of CBGA produces CBG.', 'Its presence is reported independently from downstream cannabinoids.'],
  },
  {
    kind: 'cannabinoid', slug: 'cbca', name: 'CBCA', aliases: ['CBCA', 'Cannabichromenic Acid'],
    chemicalClass: 'Acidic cannabinoid', formula: 'C22H30O4', molarMass: '358.48 g/mol',
    overview: 'Cannabichromenic acid (CBCA) is an acidic cannabinoid formed from CBGA in the plant cannabinoid biosynthetic pathway.',
    chemistryNotes: ['CBCA is the carboxylated precursor of CBC.', 'Decarboxylation removes carbon dioxide and produces the corresponding neutral cannabinoid.', 'GeoWeedo presents the lab-reported CBCA measurement without assigning an effect or trait.'],
  },
  {
    kind: 'cannabinoid', slug: 'thcva', name: 'THCVA', aliases: ['THCVA', 'Tetrahydrocannabivarinic Acid'],
    chemicalClass: 'Acidic varin cannabinoid', formula: 'C20H26O4', molarMass: '330.42 g/mol',
    overview: 'Tetrahydrocannabivarinic acid (THCVA) is the acidic precursor of THCV and belongs to the varin series of cannabinoids.',
    chemistryNotes: ['THCVA has a shorter alkyl side chain than THCA.', 'Decarboxylation of THCVA produces THCV.', 'It should remain a distinct analyte from THCA and THC in a lab profile.'],
  },
  {
    kind: 'cannabinoid', slug: 'cbda', name: 'CBDA', aliases: ['CBDA', 'Cannabidiolic Acid'],
    chemicalClass: 'Acidic cannabinoid', formula: 'C22H30O4', molarMass: '358.48 g/mol',
    overview: 'Cannabidiolic acid (CBDA) is the carboxylated precursor of CBD.',
    chemistryNotes: ['CBDA is produced in the plant from CBGA through cannabinoid biosynthesis.', 'Heating can decarboxylate CBDA to CBD.', 'CBDA and CBD are reported as separate chemical measurements when a laboratory quantifies both.'],
  },
  {
    kind: 'cannabinoid', slug: 'cbg', name: 'CBG', aliases: ['CBG', 'Cannabigerol'],
    chemicalClass: 'Neutral cannabinoid', formula: 'C21H32O2', molarMass: '316.49 g/mol',
    overview: 'Cannabigerol (CBG) is a neutral cannabinoid related to the acidic precursor CBGA.',
    chemistryNotes: ['CBG can result from decarboxylation of CBGA.', 'Its molecular structure and lab concentration are distinct from CBD, THC, and their acidic precursors.', 'GeoWeedo treats CBG as chemistry data rather than an effect label.'],
  },
  {
    kind: 'cannabinoid', slug: 'cbd', name: 'CBD', aliases: ['CBD', 'Cannabidiol'],
    chemicalClass: 'Neutral cannabinoid', formula: 'C21H30O2', molarMass: '314.47 g/mol',
    overview: 'Cannabidiol (CBD) is a neutral cannabinoid that can be formed from CBDA by decarboxylation.',
    chemistryNotes: ['CBD and THC share the same molecular formula but have different molecular structures.', 'Laboratories may report CBD and CBDA separately.', 'GeoWeedo does not infer a consumer trait from the presence or amount of CBD.'],
  },
  {
    kind: 'terpene', slug: 'myrcene', name: 'Myrcene', aliases: ['Myrcene', 'Beta-Myrcene', 'β-Myrcene'],
    chemicalClass: 'Acyclic monoterpene', formula: 'C10H16', molarMass: '136.24 g/mol',
    overview: 'Myrcene is an acyclic monoterpene hydrocarbon found in cannabis and many other plants.',
    chemistryNotes: ['Built from two isoprene units.', 'It is a volatile hydrocarbon and contains no oxygen atoms.', 'Its concentration in a cannabis sample is a chemical measurement, not a prediction of a consumer effect.'],
    naturalOccurrence: ['Hops', 'Bay', 'Thyme', 'Mango'], sensory: ['Earthy', 'Herbal', 'Musky'],
  },
  {
    kind: 'terpene', slug: 'limonene', name: 'Limonene', aliases: ['Limonene', 'D-Limonene', 'd-Limonene'],
    chemicalClass: 'Cyclic monoterpene', formula: 'C10H16', molarMass: '136.24 g/mol',
    overview: 'Limonene is a cyclic monoterpene hydrocarbon widely associated with citrus peel oils and also found in cannabis.',
    chemistryNotes: ['Limonene is a chiral molecule and occurs as different enantiomers.', 'It is composed only of carbon and hydrogen.', 'GeoWeedo uses aroma descriptors as sensory chemistry context, not as effect claims.'],
    naturalOccurrence: ['Citrus peel oils', 'Juniper', 'Mint family plants'], sensory: ['Citrus', 'Lemon', 'Orange peel'],
  },
  {
    kind: 'terpene', slug: 'beta-caryophyllene', name: 'β-Caryophyllene', aliases: ['Beta-Caryophyllene', 'β-Caryophyllene', 'Caryophyllene', 'b-Caryophyllene'],
    chemicalClass: 'Bicyclic sesquiterpene', formula: 'C15H24', molarMass: '204.36 g/mol',
    overview: 'Beta-caryophyllene is a bicyclic sesquiterpene hydrocarbon found in cannabis and a variety of aromatic plants.',
    chemistryNotes: ['Contains fifteen carbon atoms, placing it in the sesquiterpene family.', 'Its bicyclic structure distinguishes it from simpler monoterpenes such as limonene and myrcene.', 'GeoWeedo does not map its presence to a predicted mood, feeling, or medical outcome.'],
    naturalOccurrence: ['Black pepper', 'Clove', 'Hops'], sensory: ['Peppery', 'Woody', 'Spicy'],
  },
  {
    kind: 'terpene', slug: 'alpha-pinene', name: 'α-Pinene', aliases: ['Alpha-Pinene', 'α-Pinene', 'a-Pinene'],
    chemicalClass: 'Bicyclic monoterpene', formula: 'C10H16', molarMass: '136.24 g/mol',
    overview: 'Alpha-pinene is a bicyclic monoterpene hydrocarbon common in conifers and also measured in some cannabis samples.',
    chemistryNotes: ['Its compact bicyclic structure gives it different physical behavior from acyclic monoterpenes.', 'Alpha-pinene and beta-pinene have the same molecular formula but different structures.', 'Aroma descriptions are not used by GeoWeedo as effect predictions.'],
    naturalOccurrence: ['Pine resin', 'Rosemary', 'Conifers'], sensory: ['Pine', 'Resinous', 'Fresh'],
  },
  {
    kind: 'terpene', slug: 'beta-pinene', name: 'β-Pinene', aliases: ['Beta-Pinene', 'β-Pinene', 'b-Pinene'],
    chemicalClass: 'Bicyclic monoterpene', formula: 'C10H16', molarMass: '136.24 g/mol',
    overview: 'Beta-pinene is a bicyclic monoterpene hydrocarbon and a structural isomer of alpha-pinene.',
    chemistryNotes: ['Alpha-pinene and beta-pinene share a molecular formula but differ in double-bond placement.', 'It is volatile and hydrophobic.', 'GeoWeedo keeps the chemistry separate from claims about consumer experience.'],
    naturalOccurrence: ['Pine', 'Parsley', 'Dill'], sensory: ['Pine', 'Woody', 'Green'],
  },
  {
    kind: 'terpene', slug: 'linalool', name: 'Linalool', aliases: ['Linalool'],
    chemicalClass: 'Acyclic monoterpene alcohol', formula: 'C10H18O', molarMass: '154.25 g/mol',
    overview: 'Linalool is an oxygen-containing monoterpene alcohol found in many aromatic plants and in some cannabis samples.',
    chemistryNotes: ['Unlike hydrocarbon terpenes such as myrcene, linalool contains an alcohol functional group.', 'Linalool is chiral and occurs as different enantiomers.', 'GeoWeedo reports sensory descriptors without converting them into effect claims.'],
    naturalOccurrence: ['Lavender', 'Coriander', 'Basil'], sensory: ['Floral', 'Lavender-like', 'Soft spice'],
  },
  {
    kind: 'terpene', slug: 'humulene', name: 'Humulene', aliases: ['Humulene', 'Alpha-Humulene', 'α-Humulene'],
    chemicalClass: 'Monocyclic sesquiterpene', formula: 'C15H24', molarMass: '204.36 g/mol',
    overview: 'Humulene is a sesquiterpene hydrocarbon found prominently in hops and also detected in cannabis.',
    chemistryNotes: ['Humulene is an isomer of beta-caryophyllene: both share C15H24 but have different structures.', 'Its fifteen-carbon framework places it in the sesquiterpene family.', 'GeoWeedo does not assign a consumer trait to humulene concentration.'],
    naturalOccurrence: ['Hops', 'Sage', 'Ginseng'], sensory: ['Woody', 'Herbal', 'Hoppy'],
  },
  {
    kind: 'terpene', slug: 'terpinolene', name: 'Terpinolene', aliases: ['Terpinolene'],
    chemicalClass: 'Cyclic monoterpene', formula: 'C10H16', molarMass: '136.24 g/mol',
    overview: 'Terpinolene is a cyclic monoterpene hydrocarbon found in a range of plants and in some cannabis terpene profiles.',
    chemistryNotes: ['It is an isomeric monoterpene with the formula C10H16.', 'Its identity depends on molecular structure, not simply elemental composition.', 'GeoWeedo presents it as a measured chemical constituent without an effect label.'],
    naturalOccurrence: ['Tea tree', 'Nutmeg', 'Cumin'], sensory: ['Herbal', 'Fresh', 'Pine-like'],
  },
];

export function chemistryProfileFor(kind: ChemistryKind, analyteName: string) {
  const target = normalize(analyteName);
  return profiles.find(profile => profile.kind === kind && profile.aliases.some(alias => normalize(alias) === target)) || null;
}

export function chemistryProfileBySlug(kind: string, slug: string) {
  if (!['cannabinoid', 'terpene', 'cannabinoids', 'terpenes'].includes(kind)) return null;
  const normalizedKind: ChemistryKind = kind.startsWith('cannabinoid') ? 'cannabinoid' : 'terpene';
  return profiles.find(profile => profile.kind === normalizedKind && profile.slug === slug) || null;
}

export function chemistryHref(kind: ChemistryKind, analyteName: string) {
  const profile = chemistryProfileFor(kind, analyteName);
  if (!profile) return null;
  const routeKind = kind === 'cannabinoid' ? 'cannabinoids' : 'terpenes';
  return `/chemistry/${routeKind}/${profile.slug}`;
}

export function productsContainingChemistry(profile: ChemistryProfile) {
  ensureWeedoFactsSchema();
  const db = getDatabase();
  const aliasSet = new Set(profile.aliases.map(normalize));
  const rows = db.prepare(`
    SELECT p.id AS product_id, p.brand_name, p.product_name,
           b.id AS batch_id, b.batch_number, b.coa_number, b.tested_at,
           a.analyte_name, a.value, a.unit
    FROM cannabis_analytes a
    JOIN cannabis_batches b ON b.id = a.batch_id
    JOIN cannabis_products p ON p.id = b.product_id
    WHERE b.verified = 1 AND a.group_name = ?
    ORDER BY a.value DESC, COALESCE(b.tested_at, b.updated_at, b.created_at) DESC
  `).all(profile.kind) as any[];

  return rows
    .filter(row => aliasSet.has(normalize(row.analyte_name)))
    .map(row => ({
      productId: row.product_id as string,
      brandName: row.brand_name as string | null,
      productName: row.product_name as string,
      batchId: row.batch_id as string,
      batchNumber: row.batch_number as string | null,
      coaNumber: row.coa_number as string | null,
      testedAt: row.tested_at as string | null,
      value: row.value as number | null,
      unit: row.unit as string | null,
    }));
}
