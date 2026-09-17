'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AdminPermission } from '@/lib/adminPermissions';
import styles from './admin.module.css';

type AdminUser = {
  username: string;
  displayName?: string;
  role: string;
  permissions?: AdminPermission[];
};

type IssueGroup = {
  category: string;
  label: string;
  count: number;
  href: string;
};

type IssueDashboard = {
  total: number;
  activeGroups: number;
  groups: IssueGroup[];
};

function hasAny(admin: AdminUser | null, permissions: AdminPermission[]) {
  return permissions.some(permission => admin?.permissions?.includes(permission));
}

export default function AdminHomePage() {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [issues, setIssues] = useState<IssueDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/auth/me', { cache: 'no-store' })
      .then(async response => {
        if (response.status === 401) { window.location.href = '/admin/login'; return null; }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Admin session check failed.');
        return body.admin || body;
      })
      .then(async value => {
        if (!value) return;
        setAdmin(value);
        if (value.permissions?.includes('data.manage')) {
          const response = await fetch('/api/admin/issues', { cache: 'no-store' });
          if (response.ok) setIssues(await response.json());
        }
      })
      .catch(() => { window.location.href = '/admin/login'; })
      .finally(() => setLoading(false));
  }, []);

  const areas = useMemo(() => {
    if (!admin) return [];
    if (admin.role === 'verified_dispensary') {
      return [{ title: 'My dispensary', description: 'Manage your public shop profile and current menu.', href: '/admin/my-dispensary' }];
    }
    const result: Array<{ title: string; description: string; href: string }> = [];
    if (hasAny(admin, ['data.manage'])) result.push({ title: 'Products', description: 'Products, batches, COAs, scans, menus, and cultivar data.', href: '/admin/products-menus' });
    if (hasAny(admin, ['locations.view', 'locations.manage', 'data.manage'])) result.push({ title: 'Dispensaries', description: 'Locations, imports, playability, imagery, and community records.', href: '/admin/dispensaries' });
    if (hasAny(admin, ['users.view', 'users.manage', 'staff.manage'])) result.push({ title: 'People', description: 'Player accounts, staff, roles, and permissions.', href: '/admin/users' });
    if (admin.role === 'admin') result.push({ title: 'Settings', description: 'Platform controls, analytics, business tools, and advanced/legacy systems.', href: '/admin/settings' });
    return result;
  }, [admin]);

  async function logout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  }

  if (loading) return <main className={styles.shell}><p className={styles.loading}>Loading GeoWeedo Admin…</p></main>;

  const activeIssues = issues?.groups.filter(group => group.count > 0) || [];

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>OVERVIEW</span>
        <h1>GeoWeedo Admin</h1>
        <p>{admin?.role === 'verified_dispensary' ? 'Manage your GeoWeedo business presence.' : 'See what needs attention, then go directly to the part of GeoWeedo you want to manage.'}</p>
      </div>
      <div className={styles.identity}>
        <span>{admin?.displayName || admin?.username}</span>
        <button type="button" onClick={logout}>Log out</button>
      </div>
    </header>

    {admin?.permissions?.includes('data.manage') ? <section className={styles.attention}>
      <div className={styles.sectionTitle}>
        <div><span className={styles.eyebrow}>NEEDS ATTENTION</span><h2>{issues ? `${issues.total} item${issues.total === 1 ? '' : 's'}` : 'Checking…'}</h2></div>
        {issues?.total ? <a href="/admin/issues">View details</a> : null}
      </div>
      {issues && activeIssues.length === 0 ? <p className={styles.clear}>Nothing currently needs manual attention.</p> : null}
      {activeIssues.length ? <div className={styles.issueRows}>
        {activeIssues.map(group => <a href={group.href} key={group.category} className={styles.issueRow}>
          <strong>{group.count}</strong><span>{group.label}</span><b>→</b>
        </a>)}
      </div> : null}
    </section> : null}

    <section className={styles.manage}>
      <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>MANAGE</span><h2>Where do you want to work?</h2></div></div>
      <div className={styles.areaRows}>
        {areas.map(area => <a href={area.href} key={area.title} className={styles.areaRow}>
          <div><strong>{area.title}</strong><span>{area.description}</span></div><b>→</b>
        </a>)}
      </div>
    </section>
  </main>;
}
