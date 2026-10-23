import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Support } from '@/components/sales/Support';

/** #450 영업실 '지원사업' — 영업 공간만(사이드바 메뉴, 하단 탭에는 없음) */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'sales') notFound();
  return <Suspense><Support /></Suspense>;
}
