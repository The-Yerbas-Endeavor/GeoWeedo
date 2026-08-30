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
  endpoint: '/api/admin/candidates/fetch-official' | '/api/admin/candidates/fetch-bc-ri';
};

const sources: Source[] = [
  {
    preset: 'british-columbia-lcrb',
    label: 'British Columbia · LCRB',
    description:
      'Official LCRB cannabis retail store map; licensed private non-medical retailers with licence number and street address.',
    endpoint: '/api/admin/candidates/fetch-bc-ri',
  },
  {
    preset: 'rhode-island-ccc',
    label: 'Rhode Island · CCC',
    description:
      'Official CCC licensed Compassion Centers with licence number, address, and website when published.',
    endpoint: '/api/admin/candidates/fetch-bc-ri',
  },
  {
    preset: 'michigan-cra',
    label: 'Michigan · CRA',
    description: 'Official CRA adult-use licensing reports; Marihuana Retailer licenses only.',
    endpoint: '/api/admin/candidates/fetch-official',
  },
  {
    preset: 'minnesota-ocm',
    label: 'Minnesota · OCM',
    description: 'Official OCM public license-holder data; issued Cannabis Retailer licenses only.',
    endpoint: '/api/admin/candidates/fetch-official',
  },
  {
    preset: 'missouri-dhss',
    label: 'Missouri · DHSS',
    description: 'Official Division of Cannabis Regulation licensed dispensary facilities.',
    endpoint: '/api/admin/candidates/fetch-official',
  },
  {
    preset: 'new-jersey-crc',
    label: 'New Jersey · CRC',
    description:
      'Official CRC licensed cannabis businesses authorized for Retailer/Dispensing activity.',
    endpoint: '/api/admin/candidates/fetch-official',
  },
];

export default function ExpandedOfficialSourceControls() {
  const [busy, setBusy] = useState<Preset | null>(null);
  const [status, setStatus] = useState('');

  async function run(source: Source) {
    setBusy(source.preset);
    setStatus(`${source.label}: fetching official data…`);

    try {
      const response = await fetch(source.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: source.preset }),
      });

      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `${source.label} fetch failed.`);

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
        British Columbia and Rhode Island are available here as direct regulator imports. Imported records
        enter the normal candidate, coordinate-enrichment, imagery-review, and approval workflow.
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
