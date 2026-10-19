import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Connections } from '@/components/marketing/Ads';

/** V41 4-2 마케팅 공간 화면(공간 권한은 앱 레이아웃에서 404) */
export default async function Page({ params }: { params: Promise<{ space: string }> }) {
  if ((await params).space !== 'marketing') notFound();
  return <Suspense><Connections /></Suspense>;
}
