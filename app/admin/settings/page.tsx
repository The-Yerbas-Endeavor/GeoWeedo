'use client';

import { useEffect, useState } from 'react';
import AdminImageryProviderSettings from '@/components/AdminImageryProviderSettings';
import styles from './settings.module.css';

type AdminUser = { role: string };

export default function AdminSettingsPage() {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/auth/me', { cache: 'no-store' })
      .then(async response => {
        if (response.status === 401) { window.location.href = '/admin/login'; return null; }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to load admin session.');
        return body.admin || body;
      })
      .then(value => {
        if (!value) return;
        if (value.role !== 'admin') { window.location.href = '/admin'; return; }
        setAdmin(value);
      })
      .catch(() => { window.location.href = '/admin'; })
      .finally(() => setLoading(false));
  }, []);

  if (loading || !admin) return <main className={styles.shell}><p>Loading settings…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <span>SETTINGS</span>
      <h1>Platform settings</h1>
      <p>Controls and less-frequent tools live here so they do not compete with day-to-day GeoWeedo operations.</p>
    </header>

    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>Street imagery</h2><p>Choose the live imagery provider and review provider usage.</p></div>
      <AdminImageryProviderSettings />
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>Platform</h2><p>Tools you may need occasionally, but not every time you open Admin.</p></div>
      <div className={styles.rows}>
        <a href="/admin/analytics"><div><strong>Analytics</strong><span>Traffic, sessions, referrals, and client reliability.</span></div><b>→</b></a>
        <a href="/admin/sponsorships"><div><strong>Business & sponsorships</strong><span>Featured listings and sponsorship records.</span></div><b>→</b></a>
      </div>
    </section>

    <details className={styles.legacy}>
      <summary>Advanced / legacy systems</summary>
      <p>Kept available without presenting these as core GeoWeedo operations.</p>
      <div className={styles.rows}>
        <a href="/admin/wallet"><div><strong>Yerbas wallet</strong><span>Legacy wallet and ledger administration.</span></div><b>→</b></a>
        <a href="/admin/rewards"><div><strong>Rewards</strong><span>Legacy gameplay reward policy and ledger.</span></div><b>→</b></a>
        <a href="/admin/withdrawals"><div><strong>Withdrawals</strong><span>Legacy withdrawal workflow.</span></div><b>→</b></a>
      </div>
    </details>
  </main>;
}
