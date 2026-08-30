import AdminHeaderHomeLink from '@/components/AdminHeaderHomeLink';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}<AdminHeaderHomeLink /></>;
}
