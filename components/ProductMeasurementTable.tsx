'use client';

import { useMemo, useState } from 'react';

type ProductMeasurementRow = {
  id: string;
  productName: string;
  productHref: string;
  batchLabel: string;
  testedAt: string | null;
  value: number | null;
  valueLabel: string;
};

type SortKey = 'product' | 'batch' | 'date' | 'result';
type SortDirection = 'asc' | 'desc';

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function dateValue(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function ProductMeasurementTable({ rows }: { rows: ProductMeasurementRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('result');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const next = [...rows];
    next.sort((a, b) => {
      let result = 0;
      if (sortKey === 'product') result = compareText(a.productName, b.productName);
      else if (sortKey === 'batch') result = compareText(a.batchLabel, b.batchLabel);
      else if (sortKey === 'date') result = dateValue(a.testedAt) - dateValue(b.testedAt);
      else {
        const aValue = a.value === null || !Number.isFinite(Number(a.value)) ? Number.NEGATIVE_INFINITY : Number(a.value);
        const bValue = b.value === null || !Number.isFinite(Number(b.value)) ? Number.NEGATIVE_INFINITY : Number(b.value);
        result = aValue - bValue;
      }
      if (result === 0) result = compareText(a.productName, b.productName);
      return sortDirection === 'asc' ? result : -result;
    });
    return next;
  }, [rows, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleRows = sorted.slice(pageStart, pageStart + pageSize);
  const rangeStart = sorted.length ? pageStart + 1 : 0;
  const rangeEnd = Math.min(pageStart + pageSize, sorted.length);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDirection(direction => direction === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDirection(key === 'date' || key === 'result' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const sortButton = (key: SortKey, label: string) => {
    const active = sortKey === key;
    const indicator = active ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';
    return (
      <button type="button" onClick={() => toggleSort(key)} aria-label={`Sort by ${label}`}>
        {label}{indicator}
      </button>
    );
  };

  return (
    <div className="productDataTableBlock">
      <div className="productDataTableToolbar">
        <span>{rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {sorted.length.toLocaleString()} records</span>
        <label>
          Rows
          <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>
      <div className="productDataTableScroll">
        <table className="productDataTable">
          <thead>
            <tr>
              <th scope="col" aria-sort={sortKey === 'product' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortButton('product', 'Product')}</th>
              <th scope="col" aria-sort={sortKey === 'batch' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortButton('batch', 'Batch')}</th>
              <th scope="col" aria-sort={sortKey === 'date' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortButton('date', 'Test date')}</th>
              <th scope="col" className="productDataTableNumeric" aria-sort={sortKey === 'result' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>{sortButton('result', 'Result')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => (
              <tr key={row.id}>
                <td><a className="weedoFactsChemistryLink" href={row.productHref}>{row.productName}</a></td>
                <td>{row.batchLabel}</td>
                <td>{formatDate(row.testedAt)}</td>
                <td className="productDataTableNumeric"><strong>{row.valueLabel}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <nav className="productDataTablePagination" aria-label="Product table pages">
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>← Previous</button>
          <strong>Page {currentPage.toLocaleString()} of {pageCount.toLocaleString()}</strong>
          <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Next →</button>
        </nav>
      ) : null}
    </div>
  );
}
