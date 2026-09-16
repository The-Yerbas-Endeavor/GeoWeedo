'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './issues.module.css';

type IssueSample = {
  id: string;
  title: string;
  detail: string;
  updatedAt: string | null;
  href?: string | null;
  resolvable?: boolean;
};

type IssueGroup = {
  category: string;
  label: string;
  description: string;
  count: number;
  href: string;
  samples: IssueSample[];
};

type Dashboard = {
  generatedAt: string;
  staleHours: number;
  total: number;
  activeGroups: number;
  groups: IssueGroup[];
};

function initialCategory() {
  if (typeof window === 'undefined') return 'all';
  return new URLSearchParams(window.location.search).get('category') || 'all';
}

function when(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function AdminIssuesPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/issues', { cache: 'no-store' });
      if (response.status === 401) { window.location.href = '/admin/login'; return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Unable to load GeoWeedo issues.');
      setDashboard(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load GeoWeedo issues.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCategory(initialCategory());
    load();
  }, []);

  function choose(next: string) {
    setCategory(next);
    const url = new URL(window.location.href);
    if (next === 'all') url.searchParams.delete('category');
    else url.searchParams.set('category', next);
    window.history.replaceState({}, '', url);
  }

  async function resolveEvent(eventId: string) {
    setBusy(eventId);
    setError('');
    try {
      const response = await fetch('/api/admin/issues', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Unable to resolve issue event.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resolve issue event.');
    } finally {
      setBusy('');
    }
  }

  const visible = useMemo(() => {
    const groups = dashboard?.groups || [];
    return category === 'all' ? groups : groups.filter(group => group.category === category);
  }, [dashboard, category]);

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <a href="/admin">← Admin</a>
        <span>GEOWEEDO OPERATIONS</span>
        <h1>Issues</h1>
        <p>One place for records that actually need human attention. Fix the source record and derived issues disappear automatically.</p>
      </div>
      <button type="button" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </header>

    <section className={styles.summary}>
      <div><strong>{dashboard?.total ?? '—'}</strong><span>items needing attention</span></div>
      <div><strong>{dashboard?.activeGroups ?? '—'}</strong><span>active issue groups</span></div>
      <div><strong>{dashboard?.staleHours ?? 24}h</strong><span>imported-menu stale threshold</span></div>
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}

    <nav className={styles.filters} aria-label="Issue categories">
      <button className={category === 'all' ? styles.active : ''} onClick={() => choose('all')}>All</button>
      {(dashboard?.groups || []).map(group => <button key={group.category} className={category === group.category ? styles.active : ''} onClick={() => choose(group.category)}>
        {group.label} <b>{group.count}</b>
      </button>)}
    </nav>

    {loading && !dashboard ? <p className={styles.loading}>Loading issue queues…</p> : null}

    <section className={styles.groups}>
      {visible.map(group => <article key={group.category} className={`${styles.group} ${group.count ? styles.needsAttention : styles.clear}`}>
        <div className={styles.groupHead}>
          <div>
            <span>{group.count ? 'NEEDS ATTENTION' : 'CLEAR'}</span>
            <h2>{group.label}</h2>
            <p>{group.description}</p>
          </div>
          <strong>{group.count}</strong>
        </div>

        {group.count === 0 ? <div className={styles.empty}>Nothing needs attention in this queue.</div> : null}

        {group.samples.length ? <div className={styles.samples}>
          {group.samples.map(sample => <div className={styles.sample} key={sample.id}>
            <div>
              <strong>{sample.title}</strong>
              <span>{sample.detail}</span>
              <small>{when(sample.updatedAt)}</small>
            </div>
            <div className={styles.actions}>
              {sample.href ? <a href={sample.href}>Open</a> : null}
              {sample.resolvable ? <button type="button" onClick={() => resolveEvent(sample.id)} disabled={busy === sample.id}>{busy === sample.id ? 'Resolving…' : 'Dismiss'}</button> : null}
            </div>
          </div>)}
        </div> : null}

        {group.count > group.samples.length && group.href ? <a className={styles.groupLink} href={group.href}>Open related tool →</a> : group.count > 0 && group.href && group.samples.length === 0 ? <a className={styles.groupLink} href={group.href}>Open related tool →</a> : null}
      </article>)}
    </section>
  </main>;
}
