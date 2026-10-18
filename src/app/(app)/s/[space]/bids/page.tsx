import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Bids } from '@/components/sales/SalesSrc';

/** V41 단계 2 영업 공간 화면(공간 권한은 앱 레이아웃에서 404) */
export default async function Page({ params, searchParams }: { params: Promise<{ space: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  if ((await params).space !== 'sales') notFound();
  const sp = await searchParams;
  return <Suspense><Bids {...({ initialId: sp.id, initialTab: sp.tab } as any)} /></Suspense>;
}
