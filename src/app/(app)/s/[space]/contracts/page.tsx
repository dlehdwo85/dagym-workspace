import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Contracts } from '@/components/sales/SalesSrc';

/** S2-6 계약만료·재입찰(영업관리 2-6) — 영업 공간만 */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'sales') notFound();
  return <Suspense><Contracts /></Suspense>;
}
