import type { ReactNode } from 'react';
import styles from './weedo-facts-nav.module.css';

export default function WeedoFactsAdminLayout({ children }: { children: ReactNode }) {
  return <>
    <nav className={styles.nav} aria-label="Weedo Facts admin">
      <a href="/admin">Admin</a>
      <a href="/admin/weedo-facts">COA review</a>
      <a href="/admin/weedo-facts/issues">Issues</a>
      <a href="/admin/weedo-facts/sources">Sources</a>
      <a href="/facts" target="_blank" rel="noreferrer">Open Facts ↗</a>
    </nav>
    {children}
  </>;
}
