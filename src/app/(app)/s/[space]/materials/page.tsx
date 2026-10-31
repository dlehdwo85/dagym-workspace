import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Materials } from '@/components/marketing/Materials';

/** 297차 #836 마케팅 › 자료 요청(공간 권한은 앱 레이아웃에서 404) */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'marketing') notFound();
  return <Suspense><Materials /></Suspense>;
}
