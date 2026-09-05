import './analytics-users.css';
import AdminHeaderHomeLink from '@/components/AdminHeaderHomeLink';
import AdminTreasuryBalance from '@/components/AdminTreasuryBalance';
import AdminIndividualVisitors from '@/components/AdminIndividualVisitors';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<AdminIndividualVisitors/><AdminHeaderHomeLink /><AdminTreasuryBalance /></>;
}
