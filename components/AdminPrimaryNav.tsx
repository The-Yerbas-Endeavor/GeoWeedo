'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { AdminPermission } from '@/lib/adminPermissions';
import styles from './AdminPrimaryNav.module.css';

type AdminUser = {
  role: string;
  permissions?: AdminPermission[];
};

type NavItem = { label: string; href: string; active: boolean };
const ADMIN_CACHE_KEY = 'geoweedo-admin-shell-user';

function hasAny(admin: AdminUser | null, permissions: AdminPermission[]) {
  return permissions.some(permission => admin?.permissions?.includes(permission));
}

function inSettings(pathname: string) {
  return pathname.startsWith('/admin/settings')
    || pathname.startsWith('/admin/sponsorships')
    || pathname.startsWith('/admin/wallet')
    || pathname.startsWith('/admin/rewards')
    || pathname.startsWith('/admin/withdrawals');
}

export default function AdminPrimaryNav() {
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminUser | null>(null);

  useEffect(() => {
    if (pathname === '/admin/login') return;
    try {
      const cached = sessionStorage.getItem(ADMIN_CACHE_KEY);
      if (cached) setAdmin(JSON.parse(cached));
    } catch { /* cache is optional */ }

    fetch('/api/admin/auth/me', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) return null;
        const body = await response.json();
        return body.admin || body;
      })
      .then(value => {
        if (!value) return;
        setAdmin(value);
        try { sessionStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(value)); } catch { /* optional */ }
      })
      .catch(() => undefined);
    // The admin layout persists across Next.js client navigation. Auth only needs
    // to be resolved once for the shell instead of on every section click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const primary = useMemo<NavItem[]>(() => {
    if (!admin) return [{ label: 'Overview', href: '/admin', active: pathname === '/admin' || pathname.startsWith('/admin/issues') }];
    if (admin.role === 'verified_dispensary') {
      return [
        { label: 'Overview', href: '/admin', active: pathname === '/admin' },
        { label: 'My dispensary', href: '/admin/my-dispensary', active: pathname.startsWith('/admin/my-dispensary') },
      ];
    }

    const items: NavItem[] = [{ label: 'Overview', href: '/admin', active: pathname === '/admin' || pathname.startsWith('/admin/issues') }];
    if (hasAny(admin, ['data.manage'])) {
      items.push({
        label: 'Products',
        href: '/admin/products-menus',
        active: pathname.startsWith('/admin/products-menus') || pathname.startsWith('/admin/weedo-facts') || pathname.startsWith('/admin/cultivar-genetics'),
      });
    }
    if (hasAny(admin, ['locations.view', 'locations.manage', 'data.manage'])) {
      items.push({
        label: 'Dispensaries',
        href: '/admin/dispensaries',
        active: pathname.startsWith('/admin/dispensaries') || pathname.startsWith('/admin/data') || pathname.startsWith('/admin/gameplay-pipeline') || pathname.startsWith('/admin/community') || pathname.startsWith('/admin/owner-review'),
      });
    }
    if (hasAny(admin, ['users.view', 'users.manage', 'staff.manage'])) {
      items.push({
        label: 'People',
        href: '/admin/users',
        active: pathname.startsWith('/admin/users') || pathname.startsWith('/admin/scouts') || pathname.startsWith('/admin/staff'),
      });
    }
    if (hasAny(admin, ['dashboard.view'])) {
      items.push({ label: 'Analytics', href: '/admin/analytics', active: pathname.startsWith('/admin/analytics') });
    }
    if (admin.role === 'admin') {
      items.push({ label: 'Settings', href: '/admin/settings', active: inSettings(pathname) });
    }
    return items;
  }, [admin, pathname]);

  const secondary = useMemo<NavItem[]>(() => {
    if (pathname.startsWith('/admin/products-menus') || pathname.startsWith('/admin/weedo-facts') || pathname.startsWith('/admin/cultivar-genetics')) {
      return [
        { label: 'Products & sightings', href: '/admin/products-menus', active: pathname.startsWith('/admin/products-menus') },
        { label: 'COAs', href: '/admin/weedo-facts', active: pathname === '/admin/weedo-facts' },
        { label: 'Sources', href: '/admin/weedo-facts/sources', active: pathname.startsWith('/admin/weedo-facts/sources') },
        { label: 'Cultivars', href: '/admin/cultivar-genetics', active: pathname.startsWith('/admin/cultivar-genetics') },
      ];
    }
    if (pathname.startsWith('/admin/dispensaries') || pathname.startsWith('/admin/data') || pathname.startsWith('/admin/gameplay-pipeline') || pathname.startsWith('/admin/community') || pathname.startsWith('/admin/owner-review')) {
      return [
        { label: 'Locations', href: '/admin/dispensaries', active: pathname.startsWith('/admin/dispensaries') },
        { label: 'Imports', href: '/admin/data', active: pathname.startsWith('/admin/data') },
        { label: 'Playability', href: '/admin/gameplay-pipeline', active: pathname.startsWith('/admin/gameplay-pipeline') },
        { label: 'Community', href: '/admin/community', active: pathname.startsWith('/admin/community') || pathname.startsWith('/admin/owner-review') },
      ];
    }
    if (pathname.startsWith('/admin/users') || pathname.startsWith('/admin/scouts') || pathname.startsWith('/admin/staff')) {
      return [
        { label: 'Users', href: '/admin/users', active: pathname.startsWith('/admin/users') },
        { label: 'Scouts', href: '/admin/scouts', active: pathname.startsWith('/admin/scouts') },
        { label: 'Staff & permissions', href: '/admin/staff', active: pathname.startsWith('/admin/staff') },
      ];
    }
    return [];
  }, [pathname]);

  if (pathname === '/admin/login') return null;

  return <div className={styles.shell}>
    <nav className={styles.primary} aria-label="GeoWeedo Admin primary navigation">
      <Link className={styles.brand} href="/admin">GEOWEEDO ADMIN</Link>
      <div className={styles.links}>
        {primary.map(item => <Link key={item.href} href={item.href} className={item.active ? styles.active : undefined}>{item.label}</Link>)}
      </div>
      <Link className={styles.site} href="/">View site ↗</Link>
    </nav>
    {secondary.length ? <nav className={styles.secondary} aria-label="Admin section navigation">
      {secondary.map(item => <Link key={item.href} href={item.href} className={item.active ? styles.secondaryActive : undefined}>{item.label}</Link>)}
    </nav> : null}
  </div>;
}
