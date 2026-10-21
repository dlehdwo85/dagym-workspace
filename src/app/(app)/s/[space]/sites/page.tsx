import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Sites } from '@/components/marketing/Sites';

/** 대표 10/20 14:10 ①: 사이트별 운영 집계 */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'marketing') notFound();
  return <Suspense><Sites /></Suspense>;
}
