import { redirect } from 'next/navigation';

type Props = {
  searchParams: Promise<{
    product?: string | string[];
    batch?: string | string[];
  }>;
};

function one(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NutritionalFactsRedirect({ searchParams }: Props) {
  const query = await searchParams;
  const params = new URLSearchParams();
  const product = one(query.product)?.trim();
  const batch = one(query.batch)?.trim();
  if (product) params.set('product', product);
  if (batch) params.set('batch', batch);
  redirect(`/product-chemistry${params.size ? `?${params.toString()}` : ''}`);
}
