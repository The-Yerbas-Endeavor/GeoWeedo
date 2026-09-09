type Measurement = {
  name?: string | null;
  value?: number | null;
  unit?: string | null;
};

type MetricKind = 'reported' | 'calculated' | 'missing';

type HeadlineMetric = {
  key: string;
  label: string;
  value: string;
  note: string;
  kind: MetricKind;
};

function normalizeName(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeUnit(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function findMeasurement(rows: Measurement[], aliases: string[]) {
  const wanted = new Set(aliases.map(normalizeName));
  return rows.find(row => wanted.has(normalizeName(row.name))) || null;
}

function formatMeasurement(row: Measurement | null) {
  if (!row || row.value === null || row.value === undefined || !Number.isFinite(Number(row.value))) return null;
  const value = Number(row.value).toLocaleString(undefined, { maximumFractionDigits: 3 });
  return `${value}${row.unit ? ` ${row.unit}` : ''}`;
}

function reportedMetric(key: string, label: string, rows: Measurement[], aliases: string[]): HeadlineMetric | null {
  const row = findMeasurement(rows, aliases);
  const value = formatMeasurement(row);
  return value ? { key, label, value, note: 'Lab reported', kind: 'reported' } : null;
}

function calculatedAcidTotal(
  key: string,
  label: string,
  rows: Measurement[],
  neutralAliases: string[],
  acidAliases: string[],
  formulaNote: string,
): HeadlineMetric | null {
  const neutral = findMeasurement(rows, neutralAliases);
  const acid = findMeasurement(rows, acidAliases);
  if (!neutral || !acid || neutral.value === null || neutral.value === undefined || acid.value === null || acid.value === undefined) return null;
  const neutralValue = Number(neutral.value);
  const acidValue = Number(acid.value);
  if (!Number.isFinite(neutralValue) || !Number.isFinite(acidValue)) return null;
  const neutralUnit = normalizeUnit(neutral.unit);
  const acidUnit = normalizeUnit(acid.unit);
  if (neutralUnit !== acidUnit) return null;
  const value = neutralValue + acidValue * 0.877;
  return {
    key,
    label,
    value: `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}${neutral.unit ? ` ${neutral.unit}` : ''}`,
    note: formulaNote,
    kind: 'calculated',
  };
}

function missingMetric(key: string, label: string): HeadlineMetric {
  return { key, label, value: '—', note: 'Not reported by source', kind: 'missing' };
}

export function filterHeadlineTotals(rows: Measurement[] | null | undefined, group: 'cannabinoid' | 'terpene') {
  const source = Array.isArray(rows) ? rows : [];
  const hidden = group === 'cannabinoid'
    ? new Set(['total thc', 'thc total', 'total cbd', 'cbd total', 'total cannabinoids', 'total cannabinoid', 'cannabinoids total'])
    : new Set(['total terpenes', 'total terpene', 'total terpenoids', 'total terpenoid', 'terpenes total', 'terpenoids total']);
  return source.filter(row => !hidden.has(normalizeName(row.name)));
}

export default function WeedoFactsHeadlineTotals({ cannabinoids, terpenes }: { cannabinoids?: Measurement[] | null; terpenes?: Measurement[] | null }) {
  const cannabinoidRows = Array.isArray(cannabinoids) ? cannabinoids : [];
  const terpeneRows = Array.isArray(terpenes) ? terpenes : [];

  const totalThc = reportedMetric('thc', 'Total THC', cannabinoidRows, ['Total THC', 'THC Total'])
    || calculatedAcidTotal('thc', 'Total THC', cannabinoidRows, ['THC', 'Delta 9 THC', 'Delta-9 THC', 'D9 THC'], ['THCA', 'THC Acid'], 'Calculated: THC + (THCA × 0.877)')
    || missingMetric('thc', 'Total THC');

  const totalCbd = reportedMetric('cbd', 'Total CBD', cannabinoidRows, ['Total CBD', 'CBD Total'])
    || calculatedAcidTotal('cbd', 'Total CBD', cannabinoidRows, ['CBD'], ['CBDA', 'CBD Acid'], 'Calculated: CBD + (CBDA × 0.877)')
    || missingMetric('cbd', 'Total CBD');

  const totalCannabinoids = reportedMetric('cannabinoids', 'Total Cannabinoids', cannabinoidRows, ['Total Cannabinoids', 'Total Cannabinoid', 'Cannabinoids Total'])
    || missingMetric('cannabinoids', 'Total Cannabinoids');

  const totalTerpenes = reportedMetric('terpenes', 'Total Terpenes', terpeneRows, ['Total Terpenes', 'Total Terpene', 'Total Terpenoids', 'Total Terpenoid', 'Terpenes Total', 'Terpenoids Total'])
    || missingMetric('terpenes', 'Total Terpenes');

  const metrics = [totalThc, totalCbd, totalCannabinoids, totalTerpenes];

  return (
    <section className="weedoFactsHeadlineTotals" aria-label="Primary Weedo Facts totals">
      {metrics.map(metric => (
        <div className={`weedoFactsHeadlineMetric ${metric.kind}`} key={metric.key}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          <small>{metric.note}</small>
        </div>
      ))}
    </section>
  );
}
