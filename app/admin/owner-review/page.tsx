import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'GeoWeedo Admin · Products & scans' };

export default function OwnerReviewPage() {
  redirect('/admin/products-menus?view=exceptions');
}
