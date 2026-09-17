import './analytics-users.css';
import AdminPrimaryNav from '@/components/AdminPrimaryNav';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>
    <AdminPrimaryNav />
    {children}
  </>;
}
