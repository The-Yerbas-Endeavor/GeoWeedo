'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { AdminPermission } from '@/lib/adminPermissions';
import styles from './AdminPrimaryNav.module.css';

type AdminUser = {
  role: string;
  permissions?: AdminPermission[];
};

type NavItem = { label: string; href: string; active: boolean };

function hasAny(admin: AdminUser | null, permissions: AdminPermission[]) {
  return permissions.some(permission => admin?.permissions?.includes(permission));
}

export default function AdminPrimaryNav() {
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminUser | null>(null);

  useEffect(() => {
    if (pathname === '/admin/login') return;
    fetch('/api/admin/auth/me', { cache: 'no-store' })
      .then(async response => response.ok ? (await response.json()).admin || await response.json() : null)
      .then(value => { if (value) setAdmin(value); })
      .catch(() => undefined);
  }, [pathname]);

  const primary = useMemo<NavItem[]>(() => {
    if (!admin) return [{ label: 'Overview', href: '/admin', active: pathname === '/admin' }];
    if (admin.role === 'verified_dispensary') {
      return [
        { label: 'Overview', href: '/admin', active: pathname === '/admin' },
        { label: 'My dispensary', href: '/admin/my-dispensary', active: pathname.startsWith('/admin/my-dispensary') },
      ];
    }

    const items: NavItem[] = [{ label: 'Overview', href: '/admin', active: pathname === '/admin' }];
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
        active: pathname.startsWith('/admin/users') || pathname.startsWith('/admin/staff'),
      });
    }
    if (admin.role === 'admin') {
      items.push({ label: 'Settings', href: '/admin/settings', active: pathname.startsWith('/admin/settings') });
    }
    return items;
  }, [admin, pathname]);

  const secondary = useMemo<NavItem[]>(() => {
    if (pathname.startsWith('/admin/products-menus') || pathname.startsWith('/admin/weedo-facts') || pathname.startsWith('/admin/cultivar-genetics')) {
      return [
        { label: 'Catalog & menus', href: '/admin/products-menus', active: pathname.startsWith('/admin/products-menus') },
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
    if (pathname.startsWith('/admin/users') || pathname.startsWith('/admin/staff')) {
      return [
        { label: 'Users', href: '/admin/users', active: pathname.startsWith('/admin/users') },
        { label: 'Staff & permissions', href: '/admin/staff', active: pathname.startsWith('/admin/staff') },
      ];
    }
    return [];
  }, [pathname]);

  if (pathname === '/admin/login') return null;

  return <div className={styles.shell}>
    <nav className={styles.primary} aria-label="GeoWeedo Admin primary navigation">
      <a className={styles.brand} href="/admin">GEOWEEDO ADMIN</a>
      <div className={styles.links}>
        {primary.map(item => <a key={item.href} href={item.href} className={item.active ? styles.active : undefined}>{item.label}</a>)}
      </div>
      <a className={styles.site} href="/">View site ↗</a>
    </nav>
    {secondary.length ? <nav className={styles.secondary} aria-label="Admin section navigation">
      {secondary.map(item => <a key={item.href} href={item.href} className={item.active ? styles.secondaryActive : undefined}>{item.label}</a>)}
    </nav> : null}
  </div>;
}
