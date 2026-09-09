'use client';

import { usePathname } from 'next/navigation';
import SiteHeader from '@/components/SiteHeader';

export default function PublicSiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showHeader = pathname !== '/' && !pathname.startsWith('/admin');
  return <>{showHeader ? <SiteHeader /> : null}{children}</>;
}
