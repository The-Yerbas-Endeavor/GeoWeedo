import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import FactsProductPage from '../../product/[id]/page';
import { getFactsRecordForBatchId } from '@/lib/weedoCore';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const record = getFactsRecordForBatchId(id);
  if (!record) return { title: 'Batch not found · GeoWeedo Facts' };
  return {
    title: `${record.productName} · Batch ${record.batchNumber || id} · GeoWeedo Facts`,
    description: `Exact-batch GeoGeoWeedo Facts for ${record.brandName ? `${record.brandName} ` : ''}${record.productName}.`,
    alternates: { canonical: `/facts/batch/${encodeURIComponent(id)}` },
  };
}

export default async function FactsBatchPage({ params }: Props) {
  const { id } = await params;
  const record = getFactsRecordForBatchId(id);
  if (!record?.productId) notFound();
  return FactsProductPage({
    params: Promise.resolve({ id: record.productId }),
    searchParams: Promise.resolve({ batch: id }),
  });
}
