import 'server-only';

import { promises as fs } from 'fs';
import path from 'path';
import { getDatabase } from '@/lib/sqlite';

export type ImageryProvider = 'kartaview' | 'geoweedo';

export type ApprovedDispensary = {
  id: string;
  name: string;
  slug: string;
  streetAddress?: string;
  city: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  website?: string;
  dataSource?: string;
  sourceUrl?: string;
  sourceLicense?: string;
  recreational: boolean;
  medical: boolean;
  imageryProvider: ImageryProvider;
  imageryPhotoId: string;
  imagerySequenceId?: string;
  imageryLatitude: number;
  imageryLongitude: number;
  imageryHeading?: number;
  imageryFieldOfView?: number;
  imageryProjection?: string;
  imageryUrl: string;
  priorityWeight?: number;
  sponsoredUntil?: string;
  verified: true;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DispensaryDetailUpdate = {
  name: string;
  streetAddress?: string;
  city: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  website?: string;
  dataSource?: string;
  sourceUrl?: string;
  sourceLicense?: string;
  recreational: boolean;
  medical: boolean;
};

const legacyStorePath = path.join(process.cwd(), 'data', 'runtime', 'dispensaries.json');
let migratedLegacyStore = false;

function toBoolean(value: unknown) { return Number(value) === 1; }
function optionalString(value: unknown) { return value == null || value === '' ? undefined : String(value); }
function optionalNumber(value: unknown) { return value == null ? undefined : Number(value); }

function rowToDispensary(row: Record<string, unknown>): ApprovedDispensary {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    streetAddress: optionalString(row.street_address),
    city: String(row.city),
    region: String(row.region),
    country: String(row.country),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    website: optionalString(row.website),
    dataSource: optionalString(row.data_source),
    sourceUrl: optionalString(row.source_url),
    sourceLicense: optionalString(row.source_license),
    recreational: toBoolean(row.recreational),
    medical: toBoolean(row.medical),
    imageryProvider: String(row.imagery_provider) as ImageryProvider,
    imageryPhotoId: String(row.imagery_photo_id),
    imagerySequenceId: optionalString(row.imagery_sequence_id),
    imageryLatitude: Number(row.imagery_latitude),
    imageryLongitude: Number(row.imagery_longitude),
    imageryHeading: optionalNumber(row.imagery_heading),
    imageryFieldOfView: optionalNumber(row.imagery_field_of_view),
    imageryProjection: optionalString(row.imagery_projection),
    imageryUrl: String(row.imagery_url),
    priorityWeight: optionalNumber(row.priority_weight),
    sponsoredUntil: optionalString(row.sponsored_until),
    verified: true,
    active: toBoolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function upsert(item: ApprovedDispensary) {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO dispensaries (
      id,name,slug,street_address,city,region,country,latitude,longitude,website,
      data_source,source_url,source_license,recreational,medical,imagery_provider,
      imagery_photo_id,imagery_sequence_id,imagery_latitude,imagery_longitude,
      imagery_heading,imagery_field_of_view,imagery_projection,imagery_url,
      priority_weight,sponsored_until,verified,active,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, street_address=excluded.street_address, city=excluded.city,
      region=excluded.region, country=excluded.country, latitude=excluded.latitude,
      longitude=excluded.longitude, website=excluded.website, data_source=excluded.data_source,
      source_url=excluded.source_url, source_license=excluded.source_license,
      recreational=excluded.recreational, medical=excluded.medical,
      imagery_provider=excluded.imagery_provider, imagery_photo_id=excluded.imagery_photo_id,
      imagery_sequence_id=excluded.imagery_sequence_id, imagery_latitude=excluded.imagery_latitude,
      imagery_longitude=excluded.imagery_longitude, imagery_heading=excluded.imagery_heading,
      imagery_field_of_view=excluded.imagery_field_of_view, imagery_projection=excluded.imagery_projection,
      imagery_url=excluded.imagery_url, priority_weight=excluded.priority_weight,
      sponsored_until=excluded.sponsored_until, verified=excluded.verified,
      active=excluded.active, updated_at=excluded.updated_at
  `).run(
    item.id, item.name, item.slug, item.streetAddress ?? null, item.city, item.region, item.country,
    item.latitude, item.longitude, item.website ?? null, item.dataSource ?? null, item.sourceUrl ?? null,
    item.sourceLicense ?? null, item.recreational ? 1 : 0, item.medical ? 1 : 0, item.imageryProvider,
    item.imageryPhotoId, item.imagerySequenceId ?? null, item.imageryLatitude, item.imageryLongitude,
    item.imageryHeading ?? null, item.imageryFieldOfView ?? null, item.imageryProjection ?? null,
    item.imageryUrl, item.priorityWeight ?? null, item.sponsoredUntil ?? null, 1, item.active ? 1 : 0,
    item.createdAt, item.updatedAt,
  );
}

async function migrateLegacyJsonOnce() {
  if (migratedLegacyStore) return;
  migratedLegacyStore = true;

  const db = getDatabase();
  const count = db.prepare('SELECT COUNT(*) AS count FROM dispensaries').get() as { count: number } | undefined;
  if ((count?.count ?? 0) > 0) return;

  try {
    const raw = await fs.readFile(legacyStorePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (item?.id && item?.slug && item?.imageryUrl) upsert(item as ApprovedDispensary);
    }
  } catch {
    // Fresh installs intentionally start with an empty approved-dispenary database.
  }
}

export async function readApprovedDispensaries(): Promise<ApprovedDispensary[]> {
  await migrateLegacyJsonOnce();
  const rows = getDatabase().prepare('SELECT * FROM dispensaries ORDER BY active DESC, region ASC, city ASC, name ASC').all() as Record<string, unknown>[];
  return rows.map(rowToDispensary);
}

export async function saveApprovedDispensary(input: Omit<ApprovedDispensary, 'id' | 'verified' | 'createdAt' | 'updatedAt'>) {
  await migrateLegacyJsonOnce();
  const db = getDatabase();
  const now = new Date().toISOString();
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const existing = db.prepare('SELECT id, created_at FROM dispensaries WHERE slug = ?').get(slug) as { id: string; created_at: string } | undefined;

  const next: ApprovedDispensary = {
    ...input,
    slug,
    id: existing?.id ?? `disp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    verified: true,
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
  };

  upsert(next);
  return next;
}

export async function updateDispensaryDetails(id: string, input: DispensaryDetailUpdate) {
  await migrateLegacyJsonOnce();
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE dispensaries SET
      name = ?, street_address = ?, city = ?, region = ?, country = ?,
      latitude = ?, longitude = ?, website = ?, data_source = ?, source_url = ?,
      source_license = ?, recreational = ?, medical = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name, input.streetAddress ?? null, input.city, input.region, input.country,
    input.latitude, input.longitude, input.website ?? null, input.dataSource ?? null,
    input.sourceUrl ?? null, input.sourceLicense ?? null, input.recreational ? 1 : 0,
    input.medical ? 1 : 0, now, id,
  );
  if (Number(result.changes) < 1) return null;
  const row = db.prepare('SELECT * FROM dispensaries WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToDispensary(row) : null;
}

export async function setDispensaryActive(id: string, active: boolean) {
  await migrateLegacyJsonOnce();
  const db = getDatabase();
  const result = db.prepare('UPDATE dispensaries SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, new Date().toISOString(), id);
  if (Number(result.changes) < 1) return null;
  const row = db.prepare('SELECT * FROM dispensaries WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToDispensary(row) : null;
}
