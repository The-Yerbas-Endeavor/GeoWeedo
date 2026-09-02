import AdminHeaderHomeLink from '@/components/AdminHeaderHomeLink';
import AdminTreasuryBalance from '@/components/AdminTreasuryBalance';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<AdminHeaderHomeLink /><AdminTreasuryBalance /></>;
}
