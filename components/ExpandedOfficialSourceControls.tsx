'use client';

import { useState } from 'react';

type Preset =
  | 'british-columbia-lcrb'
  | 'rhode-island-ccc'
  | 'michigan-cra'
  | 'minnesota-ocm'
  | 'missouri-dhss'
  | 'new-jersey-crc';

type Source = {
  preset: Preset;
  label: string;
  description: string;
};

type JsonRecord = Record<string, any>;

const sources: Source[] = [
  {
    preset: 'british-columbia-lcrb',
    label: 'British Columbia · LCRB',
    description:
      'Official LCRB cannabis retail store map; licensed private non-medical retailers with licence number and street address.',
  },
  {
    preset: 'rhode-island-ccc',
    label: 'Rhode Island · CCC',
    description:
      'Official CCC licensed Compassion Centers with licence number, address, and website when published.',
  },
  {
    preset: 'michigan-cra',
    label: 'Michigan · CRA',
    description: 'Official CRA adult-use licensing reports; Marihuana Retailer licenses only.',
  },
  {
    preset: 'minnesota-ocm',
    label: 'Minnesota · OCM',
    description: 'Official OCM public license-holder data; issued Cannabis Retailer licenses only.',
  },
  {
    preset: 'missouri-dhss',
    label: 'Missouri · DHSS',
    description: 'Official Division of Cannabis Regulation licensed dispensary facilities.',
  },
  {
    preset: 'new-jersey-crc',
    label: 'New Jersey · CRC',
    description:
      'Official CRC licensed cannabis businesses authorized for Retailer/Dispensing activity.',
  },
];

async function readApiResponse(response: Response): Promise<JsonRecord> {
  const body = await response.text();
  if (!body.trim()) return {};

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(body) as JsonRecord;
    } catch {
      throw new Error(`GeoWeedo API returned malformed JSON (HTTP ${response.status}).`);
    }
  }

  const plain = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const detail = plain.slice(0, 300);
  throw new Error(
    detail
      ? `GeoWeedo API returned HTTP ${response.status} instead of JSON: ${detail}`
      : `GeoWeedo API returned HTTP ${response.status} instead of JSON.`,
  );
}

export default function ExpandedOfficialSourceControls() {
  const [busy, setBusy] = useState<Preset | null>(null);
  const [status, setStatus] = useState('');

  async function run(source: Source) {
    setBusy(source.preset);
    setStatus(`${source.label}: fetching official data…`);

    try {
      const response = await fetch('/api/admin/candidates/fetch-official', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ preset: source.preset }),
      });

      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }

      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.error || data.message || `${source.label} fetch failed.`);

      setStatus(
        `${source.label}: ${data.fetched || 0} fetched · ${data.added || 0} newly imported · ${Math.max(
          0,
          (data.fetched || 0) - (data.added || 0),
        )} already present/refreshed · ${data.geocoded || 0} source records include coordinates.`,
      );
      window.dispatchEvent(new Event('geoweedo-candidates-updated'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${source.label} fetch failed.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-panel" style={{ marginBottom: 18 }}>
      <h2>Additional official sources</h2>
      <p className="admin-help">
        These sources are included in the main Fetch all available states/jurisdictions sync and can also be refreshed individually here.
        Imported records enter the normal candidate, coordinate-enrichment, imagery-review, and approval workflow.
      </p>
      {status && (
        <div className="admin-status" style={{ marginBottom: 12 }}>
          {status}
        </div>
      )}
      {sources.map((source) => (
        <div className="source-note" key={source.preset}>
          <strong>{source.label}</strong>
          <span>{source.description}</span>
          <button className="secondary" disabled={busy !== null} onClick={() => run(source)}>
            {busy === source.preset ? 'Fetching…' : 'Fetch now'}
          </button>
        </div>
      ))}
    </section>
  );
}
