import WeedoFactsBatchHistory from '@/components/WeedoFactsBatchHistory';
import WeedoFactsHeadlineTotals, { filterHeadlineTotals } from '@/components/WeedoFactsHeadlineTotals';
import type { WeedoFactsRecord } from '@/lib/weedoFacts';
import { chemistryHref, type ChemistryKind } from '@/lib/weedoChemistry';

function formatMeasurement(row: any) {
  if (row.value === null || row.value === undefined) return row.status || '—';
  const value = Number(row.value);
  if (!Number.isFinite(value)) return row.status || '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}${row.unit ? ` ${row.unit}` : ''}`;
}

function Fact({ label, value, href }: { label: string; value: string; href?: string | null }) {
  return <div className="weedoFactsRow"><span>{href ? <a className="weedoFactsChemistryLink" href={href}>{label}</a> : label}</span><strong>{value}</strong></div>;
}

function FactsSection({ title, rows, kind }: { title: string; rows: any[]; kind: ChemistryKind }) {
  return <section><h3>{title}</h3><div className="weedoFactsRows">{rows.map((row, index) => <Fact key={`${row.name}-${index}`} label={row.name} value={formatMeasurement(row)} href={chemistryHref(kind, row.name)} />)}</div></section>;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function WeedoFactsProductLabel({ record }: { record: WeedoFactsRecord }) {
  const sourcedBatch = Boolean(record.batchId && record.source?.verified);
  const directLabBatch = sourcedBatch && record.source?.type === 'lab';
  const normalizedDataset = sourcedBatch && (record.source?.type === 'public_dataset' || record.source?.name === 'Cannlytics');
  const regulatorySource = sourcedBatch && record.source?.type === 'regulatory_public';
  const sourceBackedBatch = sourcedBatch && !directLabBatch;
  const statusText = String(record.overallStatus || '').trim();
  const failed = /fail/i.test(statusText);
  const cannabinoidRows = filterHeadlineTotals(record.cannabinoids, 'cannabinoid');
  const terpeneRows = filterHeadlineTotals(record.terpenes, 'terpene');
  const complianceRows = (record.safetyTests || []).filter(row => String(row.status || '').trim());
  const measurementRows = (record.safetyTests || []).filter(row => !String(row.status || '').trim() && row.value !== null && row.value !== undefined);
  const hasChemistry = Boolean(record.cannabinoids?.length || record.terpenes?.length);
  const collected = formatDate(record.collectedAt);
  const tested = formatDate(record.testedAt);

  return (
    <article className="weedoFactsCard weedoFactsProductCard">
      <div className="weedoFactsCardHead">
        <div>
          <span className="weedoFactsEyebrow">WEEDO FACTS</span>
          <h2>{record.productName}</h2>
          <p>{[record.brandName, record.productType, record.netContents].filter(Boolean).join(' · ')}</p>
        </div>
        <span className={`weedoFactsStatus ${sourcedBatch ? 'verified' : 'partial'}`}>
          {directLabBatch ? '✓ Verified lab batch' : sourceBackedBatch ? '✓ Source-backed batch data' : 'Product record — batch needed'}
        </span>
      </div>

      {hasChemistry ? <WeedoFactsHeadlineTotals cannabinoids={record.cannabinoids} terpenes={record.terpenes} /> : null}

      {directLabBatch ? (
        <p className="weedoFactsProductNotice">
          This listing shows a verified lab batch for this product. Match the batch / lot or UID on your package before treating these values as your exact package results.
        </p>
      ) : regulatorySource ? (
        <p className="weedoFactsProductNotice">
          This batch is source-backed by the regulatory Retail ID record. GeoWeedo will promote it to a verified lab batch when an authenticated COA for this exact UID / batch is available.
        </p>
      ) : normalizedDataset ? (
        <p className="weedoFactsProductNotice">
          This batch chemistry was normalized from the {record.source?.name || 'public dataset'} and retains its source provenance. Match the batch / lot or UID on your package before treating these values as your exact package results.
        </p>
      ) : sourceBackedBatch ? (
        <p className="weedoFactsProductNotice">
          This batch has source-backed evidence, but GeoWeedo has not authenticated a direct lab COA for it yet.
        </p>
      ) : (
        <p className="weedoFactsProductNotice warning">
          GeoWeedo knows this product, but no source-backed batch-level lab record is available yet.
        </p>
      )}

      {statusText ? <div className={`weedoFactsOverallStatus ${failed ? 'failed' : 'reported'}`}><span>Lab-reported compliance status</span><strong>{statusText}</strong></div> : null}
      {cannabinoidRows.length ? <FactsSection title="Cannabinoids" rows={cannabinoidRows} kind="cannabinoid" /> : null}
      {terpeneRows.length ? <FactsSection title="Terpenes" rows={terpeneRows} kind="terpene" /> : null}

      {measurementRows.length ? <section><h3>Other lab measurements</h3><div className="weedoFactsRows">{measurementRows.map((row, index) => <Fact key={`${row.category}-${row.analyte}-${index}`} label={row.analyte || row.category} value={formatMeasurement(row)} />)}</div></section> : null}

      {complianceRows.length ? <section><h3>Testing</h3><div className="weedoFactsRows">{complianceRows.map((row, index) => <div className="weedoFactsRow" key={`${row.category}-${row.analyte}-${index}`}><span>{row.analyte || row.category}</span><strong>{row.status}</strong></div>)}</div></section> : null}

      <section>
        <h3>Batch / test information</h3>
        <div className="weedoFactsRows">
          {record.batchNumber ? <Fact label="Batch / lot" value={record.batchNumber} /> : null}
          {record.uid ? <Fact label="UID" value={record.uid} /> : null}
          {record.coaNumber ? <Fact label="Sample / COA" value={record.coaNumber} /> : null}
          {collected ? <Fact label="Collected" value={collected} /> : null}
          {tested ? <Fact label="Tested / issued" value={tested} /> : null}
          {record.labName ? <Fact label="Laboratory" value={record.labName} /> : null}
          {record.producerName ? <Fact label="Producer / manufacturer" value={record.producerName} /> : null}
        </div>
      </section>

      {(record.coaUrl || record.source?.url) ? <a className="weedoFactsCoaLink" href={record.coaUrl || record.source.url || '#'} target="_blank" rel="noreferrer">{normalizedDataset ? 'View source / COA ↗' : directLabBatch ? 'View original lab source ↗' : 'View source record ↗'}</a> : null}
      {record.productId ? <WeedoFactsBatchHistory productId={record.productId} currentBatchId={record.batchId} /> : null}
    </article>
  );
}
