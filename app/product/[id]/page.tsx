import { redirect } from 'next/navigation';
import { resolveCanonicalProductId } from '@/lib/productMaintenance';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ batch?: string | string[] }>;
};

function one(value?: string | string[]) { return Array.isArray(value) ? value[0] : value; }

export default async function LegacyProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const productId = resolveCanonicalProductId(id);
  const batch = one(query.batch);
  redirect(`/facts/product/${encodeURIComponent(productId)}${batch ? `?batch=${encodeURIComponent(batch)}` : ''}`);
}
