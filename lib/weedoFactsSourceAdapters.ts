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
