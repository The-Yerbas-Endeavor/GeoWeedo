'use client';

import { FormEvent, useState } from 'react';

type LookupResult = any;

export default function WeedoFactsLookup() {
  const [identifier, setIdentifier] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = identifier.trim();
    if (!value) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/weedo-facts/lookup?identifier=${encodeURIComponent(value)}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Lookup failed');
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="weedoFactsLookup">
      <form onSubmit={submit} className="weedoFactsLookupForm">
        <label htmlFor="weedo-facts-identifier">Product, batch, UID, barcode, or COA identifier</label>
        <div className="weedoFactsLookupRow">
          <input
            id="weedo-facts-identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Scan support comes next — paste an identifier for now"
            autoComplete="off"
          />
          <button type="submit" disabled={loading}>{loading ? 'Checking…' : 'Look up'}</button>
        </div>
      </form>

      {error ? <p className="weedoFactsError">{error}</p> : null}

      {result?.found === false ? (
        <div className="weedoFactsEmpty">
          <strong>No Weedo Facts record yet.</strong>
          <p>This is where the scanner will offer the user a lab QR scan, COA upload, or batch-label capture to help GeoWeedo find the exact report.</p>
        </div>
      ) : null}

      {result?.found && result.record ? <FactsCard record={result.record} /> : null}
    </div>
  );
}

function FactsCard({ record }: { record: any }) {
  const exact = record.matchLevel === 'exact_batch';
  return (
    <article className="weedoFactsCard">
      <div className="weedoFactsCardHead">
        <div>
          <span className="weedoFactsEyebrow">WEEDO FACTS</span>
          <h2>{record.productName}</h2>
          <p>{[record.brandName, record.productType, record.netContents].filter(Boolean).join(' · ')}</p>
        </div>
        <span className={`weedoFactsStatus ${exact ? 'verified' : 'partial'}`}>
          {exact ? '✓ Exact batch verified' : record.matchLevel === 'product_only' ? 'Product match — batch needed' : 'Community record — unverified'}
        </span>
      </div>

      {record.cannabinoids?.length ? <FactsSection title="Cannabinoids" rows={record.cannabinoids} /> : null}
      {record.terpenes?.length ? <FactsSection title="Terpenes" rows={record.terpenes} /> : null}

      {record.safetyTests?.length ? (
        <section>
          <h3>Compliance testing</h3>
          <div className="weedoFactsRows">
            {record.safetyTests.map((row: any, index: number) => (
              <div className="weedoFactsRow" key={`${row.category}-${row.analyte}-${index}`}>
                <span>{row.analyte || row.category}</span>
                <strong>{row.status || formatMeasurement(row)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h3>Batch information</h3>
        <div className="weedoFactsRows">
          {record.batchNumber ? <Fact label="Batch / lot" value={record.batchNumber} /> : null}
          {record.uid ? <Fact label="California UID" value={record.uid} /> : null}
          {record.coaNumber ? <Fact label="COA" value={record.coaNumber} /> : null}
          {record.testedAt ? <Fact label="Tested" value={new Date(record.testedAt).toLocaleDateString()} /> : null}
          {record.labName ? <Fact label="Laboratory" value={record.labName} /> : null}
          {record.producerName ? <Fact label="Producer / manufacturer" value={record.producerName} /> : null}
        </div>
      </section>

      {record.coaUrl ? <a className="weedoFactsCoaLink" href={record.coaUrl} target="_blank" rel="noreferrer">View original COA ↗</a> : null}
    </article>
  );
}

function FactsSection({ title, rows }: { title: string; rows: any[] }) {
  return (
    <section>
      <h3>{title}</h3>
      <div className="weedoFactsRows">
        {rows.map((row, index) => <Fact key={`${row.name}-${index}`} label={row.name} value={formatMeasurement(row)} />)}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="weedoFactsRow"><span>{label}</span><strong>{value}</strong></div>;
}

function formatMeasurement(row: any) {
  if (row.value === null || row.value === undefined) return row.status || '—';
  return `${Number(row.value).toLocaleString(undefined, { maximumFractionDigits: 4 })}${row.unit ? ` ${row.unit}` : ''}`;
}
