import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { AdOps } from '@/components/marketing/AdOps';

/** V44 광고 운영(공간 권한은 앱 레이아웃에서 404) */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'marketing') notFound();
  return <Suspense><AdOps /></Suspense>;
}
