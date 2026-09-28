import 'server-only';

import { isScLabsSampleUrl } from './scLabs';
import { isRetailId1A4Url } from './retailId1a4';

export type OfficialCoaAdapterId = 'sc_labs_public_page' | 'metrc_retail_id';

export type OfficialCoaAdapterMatch = {
  id: OfficialCoaAdapterId;
  official: true;
  verification: 'official_lab_source' | 'regulatory_source';
};

/**
 * Small, explicit allow-list for QR destinations GeoWeedo knows how to resolve.
 * A URL is never considered verified merely because it looks like a lab URL.
 * New laboratories/sources must add a source-specific adapter here.
 */
export function matchOfficialCoaAdapter(value: string): OfficialCoaAdapterMatch | null {
  if (isScLabsSampleUrl(value)) {
    return { id: 'sc_labs_public_page', official: true, verification: 'official_lab_source' };
  }
  if (isRetailId1A4Url(value)) {
    return { id: 'metrc_retail_id', official: true, verification: 'regulatory_source' };
  }
  return null;
}

export function isSupportedOfficialCoaUrl(value: string) {
  return Boolean(matchOfficialCoaAdapter(value));
}

export function officialSourceCandidates(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const matches: Array<{ url: string; adapter: OfficialCoaAdapterMatch }> = [];
  for (const value of values) {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const adapter = matchOfficialCoaAdapter(url);
    if (adapter) matches.push({ url, adapter });
  }
  return matches;
}
