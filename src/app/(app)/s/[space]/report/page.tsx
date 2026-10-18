import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { MonthlyReport } from '@/components/marketing/MonthlyReport';

/** 상용화 ⑧ 월간 마케팅 보고(공간 권한은 앱 레이아웃에서 404) */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'marketing') notFound();
  return <Suspense><MonthlyReport /></Suspense>;
}
