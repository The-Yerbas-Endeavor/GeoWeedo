import { redirect } from 'next/navigation';

export default function LegacyWeedoFactsIssuesPage() {
  redirect('/admin/issues?category=unknown_scans');
}
